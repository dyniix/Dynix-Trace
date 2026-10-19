import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db.ts";
import { AppError } from "../src/errors.ts";
import { createScannerPersistence, ensureScannerSchema } from "../src/scanner/persistence.ts";
import { createScanOrchestrator, SCAN_INTERRUPTED_CODE } from "../src/scanner/orchestrator.ts";
import { ScannerEngineError } from "../src/scanner/engine-error.ts";
import type {
  ExecutableMetadataCollector,
  ProcessInventoryCollector,
  ScanPersistencePort,
} from "../src/scanner/ports.ts";
import type { FindingRule } from "../src/scanner/ports.ts";
import { createMockProcessCollector, mockProcessRecord } from "./support/scanner-mocks.ts";
import { waitForTerminalScan } from "./helpers.ts";

function makePersistence(): ScanPersistencePort {
  const db = openDatabase(":memory:");
  ensureScannerSchema(db);
  return createScannerPersistence(db);
}

function abortableError(): Error {
  const error = new Error("The scan was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * A collector that waits on a gate until released, and rejects promptly when
 * the scan is cancelled through the collection context signal.
 */
function gatedCollector(): {
  collector: ProcessInventoryCollector;
  release: () => void;
  calls: () => number;
} {
  let releaseFn: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  let calls = 0;
  const collector: ProcessInventoryCollector = {
    provenance: "mocked",
    scannerVersion: "mock-gated-0.0.0",
    async collectProcesses(context) {
      calls += 1;
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          context.signal?.addEventListener("abort", () => reject(abortableError()), { once: true });
        }),
      ]);
      return {
        records: [],
        attempted: 0,
        completed: 0,
        complete: true,
        warnings: [],
        limitations: [],
      };
    },
  };
  return {
    collector,
    release: () => releaseFn?.(),
    calls: () => calls,
  };
}

test("a successful scan completes with evidence persisted and deterministic ids", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([
    mockProcessRecord({ processId: 10, executablePath: "C:\\Demo\\a.exe" }),
    mockProcessRecord({ processId: 20, executablePath: "C:\\Demo\\b.exe" }),
  ]);
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });

  const started = await orchestrator.startScan({});
  assert.equal(started.status, "QUEUED");
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.processCount, 2);
  assert.equal(job.checksAttempted, 2);
  assert.equal(job.checksCompleted, 2);
  assert.equal(job.findingsCount, 0);
  assert.equal(job.progress?.stage, "FINALIZING");
  assert.ok(job.startedAt !== null && job.completedAt !== null);

  const evidence = await persistence.listProcessEvidence(started.scanId, { limit: 10, offset: 0 });
  assert.deepEqual(
    evidence.map((item) => item.evidenceId),
    [`${started.scanId}:proc:10`, `${started.scanId}:proc:20`],
  );
  assert.equal(evidence[0]?.source, "mocked");
});

test("warnings in collection produce COMPLETED_WITH_WARNINGS, not a clean verdict", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector(
    [
      mockProcessRecord({ processId: 10, executablePath: "C:\\Demo\\a.exe" }),
      mockProcessRecord({ processId: 20, executablePath: undefined }),
    ],
    { complete: false },
  );
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "COMPLETED_WITH_WARNINGS");
  assert.ok(job.warnings.length > 0);
  assert.ok(job.limitations.length > 0);
});

test("an engine failure fails the scan with the engine error code", async () => {
  const persistence = makePersistence();
  const collector: ProcessInventoryCollector = {
    provenance: "mocked",
    scannerVersion: "mock-0.0.0",
    async collectProcesses() {
      throw new ScannerEngineError("PS_UNAVAILABLE", "Windows PowerShell is not available.");
    },
  };
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "FAILED");
  assert.equal(job.error?.code, "PS_UNAVAILABLE");
  assert.equal(job.processCount, 0);
});

test("an unexpected engine error fails safely without leaking internals", async () => {
  const persistence = makePersistence();
  const collector: ProcessInventoryCollector = {
    provenance: "mocked",
    scannerVersion: "mock-0.0.0",
    async collectProcesses() {
      throw new Error("C:\\secret\\path\\leak.sqlite");
    },
  };
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "FAILED");
  assert.equal(job.error?.code, "SCAN_ENGINE_FAILURE");
  assert.equal(job.error?.message.includes("secret"), false);
});

test("executable metadata is collected once per unique path and attached", async () => {
  const persistence = makePersistence();
  let calls = 0;
  const executableCollector: ExecutableMetadataCollector = {
    provenance: "mocked",
    async collectExecutableMetadata() {
      calls += 1;
      return {
        metadata: {
          fileSizeBytes: 1234,
          sha256: "a".repeat(64),
          signatureStatus: "UNSIGNED",
          signatureMethod: "windows-authenticode",
          signerName: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          modifiedAt: "2026-01-01T00:00:00.000Z",
        },
        warnings: [],
        limitations: [],
      };
    },
  };
  const collector = createMockProcessCollector([
    mockProcessRecord({ processId: 10, executablePath: "C:\\Demo\\shared.exe" }),
    mockProcessRecord({ processId: 20, executablePath: "C:\\Demo\\shared.exe" }),
    mockProcessRecord({ processId: 30, executablePath: "C:\\Demo\\other.exe" }),
  ]);
  const orchestrator = createScanOrchestrator({
    persistence,
    processCollector: collector,
    executableCollector,
  });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "COMPLETED");
  assert.equal(calls, 2);

  const evidence = await persistence.listProcessEvidence(started.scanId, { limit: 10, offset: 0 });
  const hashes = new Set(evidence.map((item) => item.executable?.sha256.value ?? null));
  assert.deepEqual([...hashes], ["a".repeat(64)]);
});

test("finding rules produce persisted findings with rule linkage", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([mockProcessRecord({ processId: 42 })]);
  const rule: FindingRule = {
    id: "demo-rule",
    category: "process_metadata",
    evaluate: ({ processes }) =>
      processes.map((process) => ({
        category: "process_metadata" as const,
        title: `Demo: process ${process.processId}`,
        description: "A clearly labelled demo finding produced by a test rule.",
        severity: "info" as const,
        verificationStatus: "OBSERVED" as const,
        evidenceReferences: [
          { kind: "process" as const, refId: process.evidenceId, label: `Process ${process.processId}` },
        ],
        limitations: [],
        alternativeExplanations: [],
      })),
  };
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector, rules: [rule] });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.findingsCount, 1);

  const findings = await persistence.listFindings(started.scanId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.ruleId, "demo-rule");
  assert.equal(findings[0]?.findingId, `${started.scanId}:finding:0`);
  assert.equal(findings[0]?.evidenceReferences[0]?.refId, `${started.scanId}:proc:42`);
});

test("an invalid rule draft fails the scan instead of persisting a broken finding", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([mockProcessRecord({ processId: 42 })]);
  const badRule: FindingRule = {
    id: "bad-rule",
    category: "process_metadata",
    evaluate: () => [
      {
        category: "process_metadata" as const,
        title: "Broken",
        description: "This draft has no evidence references.",
        severity: "info" as const,
        verificationStatus: "OBSERVED" as const,
        evidenceReferences: [],
        limitations: [],
        alternativeExplanations: [],
      },
    ],
  };
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector, rules: [badRule] });
  const started = await orchestrator.startScan({});
  const job = await waitForTerminalScan(persistence, started.scanId);
  assert.equal(job.status, "FAILED");
  assert.equal(job.findingsCount, 0);
  assert.equal((await persistence.listFindings(started.scanId)).length, 0);
});

test("the queue enforces its capacity with an explicit error", async () => {
  const persistence = makePersistence();
  const gated = gatedCollector();
  const orchestrator = createScanOrchestrator({
    persistence,
    processCollector: gated.collector,
    maxConcurrentScans: 1,
    maxQueuedScans: 1,
  });

  const first = await orchestrator.startScan({});
  const second = await orchestrator.startScan({});
  await assert.rejects(
    () => orchestrator.startScan({}),
    (error: unknown) =>
      error instanceof AppError && error.code === "SCAN_QUEUE_FULL" && error.status === 429,
  );

  gated.release();
  const firstJob = await waitForTerminalScan(persistence, first.scanId);
  const secondJob = await waitForTerminalScan(persistence, second.scanId);
  assert.equal(firstJob.status, "COMPLETED");
  assert.equal(secondJob.status, "COMPLETED");
  assert.equal(gated.calls(), 2);
});

test("cancelling a queued scan removes it before it ever runs", async () => {
  const persistence = makePersistence();
  const gated = gatedCollector();
  const orchestrator = createScanOrchestrator({
    persistence,
    processCollector: gated.collector,
    maxConcurrentScans: 1,
    maxQueuedScans: 5,
  });

  const first = await orchestrator.startScan({});
  const second = await orchestrator.startScan({});
  const cancelled = await orchestrator.cancelScan(second.scanId);
  assert.equal(cancelled.status, "CANCELLED");

  gated.release();
  await waitForTerminalScan(persistence, first.scanId);
  const secondJob = await persistence.getJob(second.scanId);
  assert.equal(secondJob?.status, "CANCELLED");
  assert.equal(gated.calls(), 1, "the cancelled scan must never reach the collector");
});

test("cancelling a running scan aborts it and records CANCELLED", async () => {
  const persistence = makePersistence();
  const gated = gatedCollector();
  const orchestrator = createScanOrchestrator({ persistence, processCollector: gated.collector });
  const started = await orchestrator.startScan({});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await persistence.getJob(started.scanId))?.status, "RUNNING");

  const cancelled = await orchestrator.cancelScan(started.scanId);
  assert.equal(cancelled.status, "CANCELLED");
  const job = await persistence.getJob(started.scanId);
  assert.equal(job?.status, "CANCELLED");
  assert.ok(job?.completedAt !== null);
});

test("cancel errors are explicit: unknown scan, already finished scan", async () => {
  const persistence = makePersistence();
  const gated = gatedCollector();
  const orchestrator = createScanOrchestrator({ persistence, processCollector: gated.collector });
  await assert.rejects(
    () => orchestrator.cancelScan("scan-missing"),
    (error: unknown) => error instanceof AppError && error.code === "SCAN_NOT_FOUND" && error.status === 404,
  );

  const started = await orchestrator.startScan({});
  gated.release();
  await waitForTerminalScan(persistence, started.scanId);
  await assert.rejects(
    () => orchestrator.cancelScan(started.scanId),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_TRANSITION" && error.status === 409,
  );
});

test("without a collector the scanner refuses to start anything", async () => {
  const persistence = makePersistence();
  const orchestrator = createScanOrchestrator({ persistence, processCollector: null });
  await assert.rejects(
    () => orchestrator.startScan({}),
    (error: unknown) => error instanceof AppError && error.code === "SCANNER_UNAVAILABLE" && error.status === 503,
  );
});

test("restart recovery fails interrupted jobs with SCAN_INTERRUPTED and leaves finished jobs alone", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([mockProcessRecord({ processId: 1 })]);
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });

  const done = await orchestrator.startScan({});
  await waitForTerminalScan(persistence, done.scanId);

  const interruptedRunning = "scan-interrupted-running";
  const interruptedQueued = "scan-interrupted-queued";
  await persistence.createJob({
    scanId: interruptedRunning,
    status: "QUEUED",
    platform: "win32",
    scannerVersion: "mock-0.0.0",
    collectorProvenance: "mocked",
    progress: null,
    checksAttempted: 0,
    checksCompleted: 0,
    processCount: 0,
    findingsCount: 0,
    warnings: [],
    limitations: [],
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  });
  await persistence.updateJob(interruptedRunning, { status: "RUNNING", startedAt: "2026-01-01T00:00:01.000Z" });
  await persistence.createJob({
    scanId: interruptedQueued,
    status: "QUEUED",
    platform: "win32",
    scannerVersion: "mock-0.0.0",
    collectorProvenance: "mocked",
    progress: null,
    checksAttempted: 0,
    checksCompleted: 0,
    processCount: 0,
    findingsCount: 0,
    warnings: [],
    limitations: [],
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  });

  const recovered = await orchestrator.recoverInterruptedScans();
  assert.equal(recovered, 2);
  for (const scanId of [interruptedRunning, interruptedQueued]) {
    const job = await persistence.getJob(scanId);
    assert.equal(job?.status, "FAILED");
    assert.equal(job?.error?.code, SCAN_INTERRUPTED_CODE);
    assert.ok(job?.completedAt !== null);
  }
  assert.equal((await persistence.getJob(done.scanId))?.status, "COMPLETED");
});

test("the console feed records executed steps in sequence order", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([
    mockProcessRecord({ processId: 10, executablePath: "C:\\Demo\\a.exe" }),
    mockProcessRecord({ processId: 20, executablePath: "C:\\Demo\\b.exe" }),
  ]);
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });
  const started = await orchestrator.startScan({});
  await waitForTerminalScan(persistence, started.scanId);

  const events = await persistence.listScanEvents(started.scanId, { afterSeq: 0, limit: 200 });
  assert.ok(events.length >= 8, `expected a full feed, got ${events.length} events`);
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_, index) => index + 1),
    "sequence numbers must be contiguous and ordered",
  );

  const first = events[0]!;
  assert.equal(first.kind, "command");
  assert.ok(first.text.includes("dynix-trace scan --profile=process-inventory"));
  assert.ok(first.text.includes(started.scanId));

  assert.ok(
    events.some((event) => event.kind === "warn" && event.text.includes("collector is mocked")),
    "mocked collectors must be announced as a warning",
  );
  assert.ok(
    events.some((event) => event.kind === "command" && event.text === "> (mock) enumerate process inventory"),
  );
  assert.ok(
    events.some((event) => event.kind === "success" && event.text === "enumerated 2 processes"),
  );
  assert.ok(events.some((event) => event.kind === "success" && event.text === "evidence stored"));

  const last = events[events.length - 1]!;
  assert.equal(last.kind, "success");
  assert.equal(last.text, "trace complete — report ready");
  const beforeLast = events[events.length - 2]!;
  assert.ok(beforeLast.text.includes("COMPLETED"), beforeLast.text);
  assert.ok(beforeLast.text.includes("2 processes"), beforeLast.text);
  for (const event of events) {
    assert.ok(Number.isFinite(Date.parse(event.createdAt)), event.createdAt);
  }

  const tail = await persistence.listScanEvents(started.scanId, { afterSeq: last.seq - 1, limit: 200 });
  assert.equal(tail.length, 1);
  assert.equal(tail[0]!.seq, last.seq);
});

test("high-severity findings become red risk events, medium findings become warnings", async () => {
  const persistence = makePersistence();
  const collector = createMockProcessCollector([mockProcessRecord({ processId: 42 })]);
  const rule: FindingRule = {
    id: "severity-demo",
    category: "process_metadata",
    evaluate: ({ processes }) =>
      processes.flatMap((process) => [
        {
          category: "process_metadata" as const,
          title: `High: process ${process.processId}`,
          description: "A high-severity demo finding used to test the console feed.",
          severity: "high" as const,
          verificationStatus: "OBSERVED" as const,
          evidenceReferences: [
            { kind: "process" as const, refId: process.evidenceId, label: `Process ${process.processId}` },
          ],
          limitations: [],
          alternativeExplanations: [],
        },
        {
          category: "process_metadata" as const,
          title: `Medium: process ${process.processId}`,
          description: "A medium-severity demo finding used to test the console feed.",
          severity: "medium" as const,
          verificationStatus: "OBSERVED" as const,
          evidenceReferences: [
            { kind: "process" as const, refId: process.evidenceId, label: `Process ${process.processId}` },
          ],
          limitations: [],
          alternativeExplanations: [],
        },
      ]),
  };
  const orchestrator = createScanOrchestrator({
    persistence,
    processCollector: collector,
    rules: [rule],
  });
  const started = await orchestrator.startScan({});
  await waitForTerminalScan(persistence, started.scanId);

  const events = await persistence.listScanEvents(started.scanId, { afterSeq: 0, limit: 200 });
  const risk = events.find((event) => event.kind === "risk");
  const warn = events.find((event) => event.kind === "warn" && event.text.includes("Medium:"));
  assert.ok(risk, "a high-severity finding must produce a risk event");
  assert.ok(risk.text.startsWith("HIGH · High: process 42"), risk.text);
  assert.ok(risk.text.includes("Process 42"), risk.text);
  assert.ok(warn, "a medium-severity finding must produce a warn event");
  assert.ok(warn.text.startsWith("MEDIUM · Medium: process 42"), warn.text);
});

test("a failed scan ends its console feed with an error event", async () => {
  const persistence = makePersistence();
  const collector: ProcessInventoryCollector = {
    provenance: "mocked",
    scannerVersion: "mock-0.0.0",
    async collectProcesses() {
      throw new ScannerEngineError("PS_UNAVAILABLE", "Windows PowerShell is not available.");
    },
  };
  const orchestrator = createScanOrchestrator({ persistence, processCollector: collector });
  const started = await orchestrator.startScan({});
  await waitForTerminalScan(persistence, started.scanId);

  const events = await persistence.listScanEvents(started.scanId, { afterSeq: 0, limit: 200 });
  const last = events[events.length - 1]!;
  assert.equal(last.kind, "error");
  assert.ok(last.text.startsWith("scan FAILED · PS_UNAVAILABLE"), last.text);
});

test("a cancelled scan records an explicit cancellation warning in its feed", async () => {
  const persistence = makePersistence();
  const gated = gatedCollector();
  const orchestrator = createScanOrchestrator({ persistence, processCollector: gated.collector });
  const started = await orchestrator.startScan({});
  await new Promise((resolve) => setTimeout(resolve, 25));
  await orchestrator.cancelScan(started.scanId);

  const events = await persistence.listScanEvents(started.scanId, { afterSeq: 0, limit: 200 });
  const last = events[events.length - 1]!;
  assert.equal(last.kind, "warn");
  assert.equal(last.text, "scan cancelled by operator");
});
