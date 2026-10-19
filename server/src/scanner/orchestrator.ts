import { randomBytes } from "node:crypto";
import { AppError } from "../errors.ts";
import {
  SCAN_PROGRESS_STAGES,
  type Finding,
  type ScanJob,
  type ScanProgress,
  type ScanRequest,
  type ScanWarning,
} from "./contracts.ts";
import type { ScanEventKind } from "./events.ts";
import { ScannerEngineError } from "./engine-error.ts";
import { assertScanTransition, isTerminalScanStatus, type ScanLifecycleStatus } from "./lifecycle.ts";
import type {
  ExecutableMetadataCollector,
  FindingRule,
  ProcessInventoryCollector,
  ScanOrchestrator,
  ScanPersistencePort,
} from "./ports.ts";
import { normalizeCollection } from "./normalize.ts";

export const SCAN_INTERRUPTED_CODE = "SCAN_INTERRUPTED";
export const DEFAULT_MAX_CONCURRENT_SCANS = 1;
export const DEFAULT_MAX_QUEUED_SCANS = 5;
export const MAX_SCAN_ID_LENGTH = 64;

export type ScanOrchestratorOptions = {
  persistence: ScanPersistencePort;
  processCollector: ProcessInventoryCollector | null;
  executableCollector?: ExecutableMetadataCollector | null;
  rules?: readonly FindingRule[];
  platform?: string;
  maxConcurrentScans?: number;
  maxQueuedScans?: number;
  clock?: () => Date;
  generateScanId?: () => string;
};

export type ScannerOrchestrator = ScanOrchestrator & {
  /**
   * Fails every job that was left QUEUED or RUNNING by a previous process.
   * The in-memory queue never survives a restart, and SQLite is the
   * authoritative record, so an interrupted scan is reported as FAILED with
   * SCAN_INTERRUPTED instead of being silently resumed or left dangling.
   */
  recoverInterruptedScans(): Promise<number>;
  countActiveScans(): number;
};

function progress(stage: (typeof SCAN_PROGRESS_STAGES)[number]): ScanProgress {
  return {
    stage,
    stageIndex: SCAN_PROGRESS_STAGES.indexOf(stage),
    totalStages: SCAN_PROGRESS_STAGES.length,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ScannerEngineError) {
    return error.message.slice(0, 300);
  }
  return "The scan failed for an unexpected reason; no partial result is being reported as complete.";
}

function errorCode(error: unknown): string {
  return error instanceof ScannerEngineError ? error.code : "SCAN_ENGINE_FAILURE";
}

export function createScanOrchestrator(options: ScanOrchestratorOptions): ScannerOrchestrator {
  const {
    persistence,
    processCollector,
    executableCollector = null,
    rules = [],
    platform = process.platform,
    maxConcurrentScans = DEFAULT_MAX_CONCURRENT_SCANS,
    maxQueuedScans = DEFAULT_MAX_QUEUED_SCANS,
    clock = () => new Date(),
    generateScanId = () => `scan-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
  } = options;

  const now = (): string => clock().toISOString();

  const queue: ScanJob[] = [];
  const controllers = new Map<string, { controller: AbortController; done: Promise<void> }>();
  let pumping = false;

  type ActiveScan = { controller: AbortController; done: Promise<void> };

  function activeScan(scanId: string): ActiveScan | undefined {
    return controllers.get(scanId);
  }

  function pump(): void {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (controllers.size < maxConcurrentScans && queue.length > 0) {
        const job = queue.shift();
        if (!job) {
          break;
        }
        const controller = new AbortController();
        const done = runScan(job, controller);
        controllers.set(job.scanId, { controller, done });
        void done
          .catch(() => {
            /* runScan finalizes its own failures; this only keeps the pump alive. */
          })
          .finally(() => {
            controllers.delete(job.scanId);
            pump();
          });
      }
    } finally {
      pumping = false;
    }
  }

  async function runScan(job: ScanJob, controller: AbortController): Promise<void> {
    const { scanId } = job;
    /**
     * Console feed writer. Every event describes a real engine step, a real
     * count or a real rule result; nothing here is embellishment.
     */
    const emit = async (kind: ScanEventKind, text: string): Promise<void> => {
      await persistence.appendScanEvents(scanId, [
        { kind, text: text.slice(0, 500), createdAt: now() },
      ]);
    };
    const emitSafe = async (kind: ScanEventKind, text: string): Promise<void> => {
      try {
        await emit(kind, text);
      } catch {
        // The scan outcome is already persisted; a failed feed write must
        // not replace the recorded failure reason.
      }
    };

    try {
      assertScanTransition("QUEUED", "RUNNING");
      await persistence.updateJob(scanId, {
        status: "RUNNING",
        startedAt: now(),
        progress: progress("INITIALIZING"),
      });
      await emit("command", `dynix-trace scan --profile=process-inventory --scan ${scanId}`);

      const context = { signal: controller.signal };
      const collector = processCollector;
      if (collector === null) {
        throw new ScannerEngineError("SCANNER_UNAVAILABLE", "No process collector is registered.");
      }
      await emit(
        "info",
        `collector ${collector.provenance} · engine ${collector.scannerVersion} · platform ${platform}`,
      );
      if (collector.provenance === "mocked") {
        await emit(
          "warn",
          "collector is mocked — evidence produced by this scan is simulated test data",
        );
      }

      await persistence.updateJob(scanId, { progress: progress("ENUMERATING_PROCESSES") });
      await emit(
        "command",
        collector.provenance === "windows-native"
          ? "> Get-CimInstance -ClassName Win32_Process"
          : "> (mock) enumerate process inventory",
      );
      const outcome = await collector.collectProcesses(context);
      await emit("success", `enumerated ${outcome.records.length} processes`);
      if (!outcome.complete) {
        await emit("warn", "partial inventory — some processes could not be fully inspected");
      }

      await persistence.updateJob(scanId, { progress: progress("COLLECTING_PROCESS_METADATA") });
      const warnings: ScanWarning[] = [];
      if (executableCollector !== null) {
        const uniquePaths = new Set<string>();
        for (const record of outcome.records) {
          const path = record.executablePath;
          if (typeof path === "string" && path.length > 0) {
            uniquePaths.add(path);
          }
        }
        if (uniquePaths.size > 0) {
          await emit(
            "command",
            `> Get-AuthenticodeSignature + SHA-256 · ${uniquePaths.size} unique executables`,
          );
        }
        const cache = new Map<string, (typeof outcome.records)[number]["executable"]>();
        let inspectedFiles = 0;
        let failedFiles = 0;
        for (const record of outcome.records) {
          if (controller.signal.aborted) {
            const abort = new Error("The scan was cancelled.");
            abort.name = "AbortError";
            throw abort;
          }
          const path = record.executablePath;
          if (typeof path !== "string" || path.length === 0) {
            continue;
          }
          if (cache.has(path)) {
            record.executable = cache.get(path) ?? null;
            continue;
          }
          try {
            const metadata = await executableCollector.collectExecutableMetadata({
              executablePath: path,
              context,
            });
            warnings.push(...metadata.warnings);
            record.executable = metadata.metadata;
            cache.set(path, metadata.metadata);
          } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) {
              throw error;
            }
            failedFiles += 1;
            warnings.push({
              code: "EXECUTABLE_METADATA_UNAVAILABLE",
              message: `Executable metadata for "${path}" could not be collected.`,
              occurrences: 1,
            });
            cache.set(path, null);
          }
          inspectedFiles += 1;
          if (inspectedFiles % 25 === 0) {
            await emit("info", `metadata ${inspectedFiles}/${uniquePaths.size} files inspected`);
          }
        }
        await emit(
          "success",
          `metadata collected for ${inspectedFiles} files${failedFiles > 0 ? ` · ${failedFiles} failed` : ""}`,
        );
      }

      await persistence.updateJob(scanId, { progress: progress("INSPECTING_EXECUTABLES") });
      const normalized = normalizeCollection(outcome, {
        scanId,
        collectionTimestamp: now(),
        source: collector.provenance,
      });
      await emit("info", `normalized ${normalized.processes.length} evidence records`);
      const allWarnings = [...warnings, ...normalized.warnings];
      const limitations = [...normalized.limitations];

      const findings: Finding[] = [];
      const createdAt = now();
      for (const rule of rules) {
        const drafts = rule.evaluate({ scanId, processes: normalized.processes });
        for (const draft of drafts) {
          findings.push({
            ...draft,
            findingId: `${scanId}:finding:${findings.length}`,
            scanId,
            ruleId: rule.id,
            createdAt,
          });
        }
      }
      // High-severity findings are the "high-probability evidence" the
      // console renders in red; medium findings are amber warnings.
      for (const finding of findings.slice(0, 60)) {
        const kind: ScanEventKind =
          finding.severity === "high" ? "risk" : finding.severity === "medium" ? "warn" : "info";
        const label = finding.evidenceReferences[0]?.label ?? "";
        await emit(
          kind,
          `${finding.severity.toUpperCase()} · ${finding.title}${label.length > 0 ? ` — ${label}` : ""}`,
        );
      }

      await persistence.updateJob(scanId, { progress: progress("PERSISTING_EVIDENCE") });
      await emit("info", `persisting ${normalized.processes.length} evidence records`);
      await persistence.appendProcessEvidence(scanId, normalized.processes);
      await emit("success", "evidence stored");
      await persistence.appendFindings(scanId, findings);
      if (findings.length > 0) {
        await emit("info", `findings stored (${findings.length})`);
      }

      await persistence.updateJob(scanId, { progress: progress("FINALIZING") });

      const terminal: ScanLifecycleStatus =
        allWarnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
      assertScanTransition("RUNNING", terminal);
      await persistence.updateJob(scanId, {
        status: terminal,
        checksAttempted: outcome.attempted,
        checksCompleted: outcome.completed,
        processCount: normalized.processes.length,
        findingsCount: findings.length,
        warnings: allWarnings.slice(0, 50),
        limitations: limitations.slice(0, 20),
        completedAt: now(),
      });
      await emit(
        "success",
        `scan ${terminal} — ${normalized.processes.length} processes · ${findings.length} findings`,
      );
      await emit("success", "trace complete — report ready");
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        await persistence.updateJob(scanId, {
          status: "CANCELLED",
          completedAt: now(),
        });
        await emitSafe("warn", "scan cancelled by operator");
        return;
      }
      await persistence.updateJob(scanId, {
        status: "FAILED",
        error: { code: errorCode(error), message: safeErrorMessage(error) },
        completedAt: now(),
      });
      await emitSafe("error", `scan FAILED · ${errorCode(error)} — ${safeErrorMessage(error)}`);
    }
  }

  return {
    async startScan(_request: ScanRequest) {
      if (processCollector === null) {
        throw new AppError(
          "SCANNER_UNAVAILABLE",
          503,
          "The process inventory scanner is not available on this platform.",
        );
      }
      if (queue.length >= maxQueuedScans && controllers.size >= maxConcurrentScans) {
        throw new AppError(
          "SCAN_QUEUE_FULL",
          429,
          `The scan queue is full (${maxQueuedScans} jobs waiting). Wait for a queued scan to start.`,
        );
      }
      const scanId = generateScanId();
      if (scanId.length < 1 || scanId.length > MAX_SCAN_ID_LENGTH) {
        throw new AppError("SCAN_ID_INVALID", 500, "Generated scan id is not usable.");
      }
      const job: ScanJob = {
        scanId,
        status: "QUEUED",
        platform,
        scannerVersion: processCollector.scannerVersion,
        collectorProvenance: processCollector.provenance,
        progress: null,
        checksAttempted: 0,
        checksCompleted: 0,
        processCount: 0,
        findingsCount: 0,
        warnings: [],
        limitations: [],
        error: null,
        createdAt: now(),
        startedAt: null,
        completedAt: null,
      };
      await persistence.createJob(job);
      queue.push(job);
      pump();
      return { scanId, status: "QUEUED" as const };
    },

    async cancelScan(scanId: string) {
      const job = await persistence.getJob(scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${scanId}" does not exist.`);
      }
      if (isTerminalScanStatus(job.status)) {
        throw new AppError(
          "INVALID_TRANSITION",
          409,
          `Scan "${scanId}" is already ${job.status} and cannot be cancelled.`,
        );
      }

      if (job.status === "QUEUED") {
        const index = queue.findIndex((queued) => queued.scanId === scanId);
        if (index >= 0) {
          queue.splice(index, 1);
        }
      }

      const refreshed = await persistence.getJob(scanId);
      if (refreshed === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${scanId}" does not exist.`);
      }
      if (refreshed.status === "QUEUED") {
        assertScanTransition("QUEUED", "CANCELLED");
        await persistence.updateJob(scanId, { status: "CANCELLED", completedAt: now() });
        return { scanId, status: "CANCELLED" as const };
      }
      if (!isTerminalScanStatus(refreshed.status)) {
        const active = activeScan(scanId);
        if (active) {
          active.controller.abort();
          try {
            await active.done;
          } catch {
            /* The failure is already persisted on the job itself. */
          }
        }
      }
      const finalJob = await persistence.getJob(scanId);
      return {
        scanId,
        status: (finalJob?.status ?? "CANCELLED") as ScanLifecycleStatus,
      };
    },

    async recoverInterruptedScans() {
      const interrupted = await persistence.listJobs({ limit: 1000 });
      let recovered = 0;
      for (const job of interrupted) {
        if (job.status === "QUEUED" || job.status === "RUNNING") {
          await persistence.updateJob(job.scanId, {
            status: "FAILED",
            error: {
              code: SCAN_INTERRUPTED_CODE,
              message: "The backend restarted while this scan was in progress, so it did not finish.",
            },
            completedAt: now(),
          });
          recovered += 1;
        }
      }
      return recovered;
    },

    countActiveScans() {
      return controllers.size + queue.length;
    },
  };
}
