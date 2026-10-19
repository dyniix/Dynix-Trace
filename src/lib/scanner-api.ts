export const DEFAULT_SCANNER_API_URL = "http://127.0.0.1:3001";

export const SCAN_LIFECYCLE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
] as const;
export type ScanLifecycleStatus = (typeof SCAN_LIFECYCLE_STATUSES)[number];

export const TERMINAL_SCAN_STATUSES: readonly ScanLifecycleStatus[] = [
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
];

export const SCAN_PROGRESS_STAGES = [
  "INITIALIZING",
  "ENUMERATING_PROCESSES",
  "COLLECTING_PROCESS_METADATA",
  "INSPECTING_EXECUTABLES",
  "PERSISTING_EVIDENCE",
  "FINALIZING",
] as const;
export type ScanProgressStage = (typeof SCAN_PROGRESS_STAGES)[number];

export const EVIDENCE_FIELD_STATUSES = [
  "OBSERVED",
  "VERIFIED",
  "INFERRED",
  "UNKNOWN",
  "ACCESS_DENIED",
  "UNAVAILABLE",
  "PROCESS_EXITED",
  "NOT_APPLICABLE",
] as const;
export type EvidenceFieldStatus = (typeof EVIDENCE_FIELD_STATUSES)[number];

export const SIGNATURE_STATUSES = ["VALID", "INVALID", "UNSIGNED", "UNKNOWN", "UNAVAILABLE"] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const SIGNATURE_METHODS = ["windows-authenticode", "mock", "none"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export type EvidenceField<T> = {
  value: T;
  status: EvidenceFieldStatus;
  note?: string;
};

export type ScanProgress = {
  stage: ScanProgressStage;
  stageIndex: number;
  totalStages: number;
};

export type ScanWarning = {
  code: string;
  message: string;
  occurrences: number;
};

export type ScanJob = {
  scanId: string;
  status: ScanLifecycleStatus;
  platform: string;
  scannerVersion: string;
  collectorProvenance: "windows-native" | "mocked";
  progress: ScanProgress | null;
  checksAttempted: number;
  checksCompleted: number;
  processCount: number;
  findingsCount: number;
  warnings: ScanWarning[];
  limitations: string[];
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type ScannerFeatureAvailability = {
  available: boolean;
  reason: string | null;
};

export type ScannerCapabilities = {
  platform: string;
  osSupported: boolean;
  collectorProvenance: "windows-native" | "mocked" | null;
  scannerVersion: string | null;
  features: {
    processInventory: ScannerFeatureAvailability;
    executableMetadata: ScannerFeatureAvailability;
    sha256Hashing: ScannerFeatureAvailability;
    signatureVerification: ScannerFeatureAvailability;
  };
  limitations: string[];
};

export type ExecutableEvidence = {
  evidenceId: string;
  path: string | null;
  fileSizeBytes: EvidenceField<number | null>;
  createdAt: EvidenceField<string | null>;
  modifiedAt: EvidenceField<string | null>;
  sha256: EvidenceField<string | null>;
  signature: {
    status: SignatureStatus;
    method: SignatureMethod;
    signerName: string | null;
  };
  limitations: string[];
};

export type ProcessEvidence = {
  evidenceId: string;
  scanId: string;
  processId: number;
  parentProcessId: EvidenceField<number | null>;
  processName: EvidenceField<string | null>;
  executablePath: EvidenceField<string | null>;
  processStartTime: EvidenceField<string | null>;
  collectionTimestamp: string;
  executable: ExecutableEvidence | null;
  source: "windows-native" | "mocked";
  limitations: string[];
};

export type Finding = {
  findingId: string;
  scanId: string;
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  verificationStatus: string;
  evidenceReferences: { kind: string; refId: string; label: string }[];
  limitations: string[];
  alternativeExplanations: string[];
  createdAt: string;
};

export const SCAN_EVENT_KINDS = ["command", "info", "success", "warn", "risk", "error"] as const;
export type ScanEventKind = (typeof SCAN_EVENT_KINDS)[number];

export type ScanEvent = {
  seq: number;
  kind: ScanEventKind;
  text: string;
  createdAt: string;
};

export type ScanEventsPage = {
  events: ScanEvent[];
  nextAfter: number | null;
};

export const RISK_BANDS = ["LOW", "MODERATE", "ELEVATED", "HIGH"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export type RiskFactor = {
  id: string;
  label: string;
  occurrences: number;
  points: number;
};

export type IntegrityRisk = {
  basis: "heuristic";
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
};

export type ScanReportStats = {
  evidenceRecords: number;
  evidenceTruncated: boolean;
  signatures: {
    valid: number;
    unsigned: number;
    invalid: number;
    unknown: number;
    unavailable: number;
    notChecked: number;
  };
  hashes: {
    present: number;
    missing: number;
  };
  paths: {
    withPath: number;
    withoutPath: number;
    system: number;
    userWritable: number;
    temp: number;
    other: number;
  };
};

export type ScanReport = {
  generatedAt: string;
  job: ScanJob;
  findings: Finding[];
  risk: IntegrityRisk;
  stats: ScanReportStats;
};

export type StartScanResult = {
  scanId: string;
  status: ScanLifecycleStatus;
};

export type EvidencePage = {
  evidence: ProcessEvidence[];
  count: number;
  limit: number;
  offset: number;
};

export class ScannerApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ScannerApiError";
    this.code = code;
    this.status = status;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function resolveDefaultBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_SCANNER_API_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_SCANNER_API_URL;
}

export const SCANNER_API_URL = resolveDefaultBaseUrl();

function invalidResponse(detail: string): ScannerApiError {
  return new ScannerApiError("INVALID_RESPONSE", 0, `Unexpected backend response: ${detail}.`);
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function expectScanJob(value: unknown): ScanJob {
  const job = expectObject(value, "scan");
  if (typeof job.scanId !== "string" || typeof job.status !== "string") {
    throw invalidResponse("scan job is missing scanId or status");
  }
  if (!SCAN_LIFECYCLE_STATUSES.includes(job.status as ScanLifecycleStatus)) {
    throw invalidResponse(`unknown scan status "${job.status}"`);
  }
  if (!Array.isArray(job.warnings) || !Array.isArray(job.limitations)) {
    throw invalidResponse("scan job warnings/limitations are missing");
  }
  return job as unknown as ScanJob;
}

function expectScanEvent(value: unknown): ScanEvent {
  const event = expectObject(value, "scan event");
  if (typeof event.seq !== "number" || typeof event.text !== "string") {
    throw invalidResponse("scan event is missing seq or text");
  }
  if (!SCAN_EVENT_KINDS.includes(event.kind as ScanEventKind)) {
    throw invalidResponse(`unknown scan event kind "${String(event.kind)}"`);
  }
  if (typeof event.createdAt !== "string") {
    throw invalidResponse("scan event is missing createdAt");
  }
  return {
    seq: event.seq,
    kind: event.kind as ScanEventKind,
    text: event.text,
    createdAt: event.createdAt,
  };
}

export function createScannerClient(
  baseUrl: string = SCANNER_API_URL,
  fetchImpl: FetchLike = fetch,
) {  const inflightGets = new Map<string, Promise<unknown>>();

  async function perform<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new ScannerApiError(
        "BACKEND_UNREACHABLE",
        0,
        "Local backend is not reachable. Start it with npm run dev inside the server/ directory.",
      );
    }

    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      let message = `Request failed with HTTP ${response.status}.`;
      try {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        if (typeof body?.error?.code === "string") code = body.error.code;
        if (typeof body?.error?.message === "string") message = body.error.message;
      } catch {
        // Non-JSON error body - keep the HTTP status defaults.
      }
      throw new ScannerApiError(code, response.status, message);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw invalidResponse("body is not valid JSON");
    }
  }

  function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      return perform<T>(path, init);
    }
    // React StrictMode mounts effects twice in development; identical
    // concurrent GETs share a single in-flight promise instead of
    // duplicating backend requests.
    const key = `${method} ${path}`;
    const existing = inflightGets.get(key);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }
    const pending = perform<T>(path, init).finally(() => {
      inflightGets.delete(key);
    });
    inflightGets.set(key, pending);
    return pending;
  }

  return {
    getCapabilities: async (): Promise<ScannerCapabilities> => {
      const body = expectObject(await request<unknown>("/api/scanner/capabilities"), "capabilities envelope");
      const capabilities = expectObject(body.capabilities, "capabilities");
      if (typeof capabilities.platform !== "string" || typeof capabilities.osSupported !== "boolean") {
        throw invalidResponse("capabilities are missing platform or osSupported");
      }
      return capabilities as unknown as ScannerCapabilities;
    },

    startScan: async (): Promise<StartScanResult> => {
      const body = expectObject(
        await request<unknown>("/api/scanner/scans", { method: "POST", body: "{}" }),
        "start scan envelope",
      );
      const scan = expectObject(body.scan, "start scan result");
      if (typeof scan.scanId !== "string" || typeof scan.status !== "string") {
        throw invalidResponse("start scan result is missing scanId or status");
      }
      return { scanId: scan.scanId, status: scan.status as ScanLifecycleStatus };
    },

    getScan: async (scanId: string): Promise<ScanJob> => {
      const body = expectObject(await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}`), "scan envelope");
      return expectScanJob(body.scan);
    },

    listScans: async (limit: number = 50): Promise<ScanJob[]> => {
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans?limit=${encodeURIComponent(String(limit))}`),
        "scan list envelope",
      );
      if (!Array.isArray(body.scans)) throw invalidResponse("scan list is missing");
      return body.scans.map(expectScanJob);
    },

    cancelScan: async (scanId: string): Promise<StartScanResult> => {
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}/cancel`, { method: "POST", body: "{}" }),
        "cancel scan envelope",
      );
      const scan = expectObject(body.scan, "cancel scan result");
      if (typeof scan.scanId !== "string" || typeof scan.status !== "string") {
        throw invalidResponse("cancel scan result is missing scanId or status");
      }
      return { scanId: scan.scanId, status: scan.status as ScanLifecycleStatus };
    },

    getEvidence: async (scanId: string, options: { limit: number; offset: number }): Promise<EvidencePage> => {
      const query = `limit=${encodeURIComponent(String(options.limit))}&offset=${encodeURIComponent(String(options.offset))}`;
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}/evidence?${query}`),
        "evidence envelope",
      );
      if (!Array.isArray(body.evidence)) throw invalidResponse("evidence list is missing");
      return {
        evidence: body.evidence as ProcessEvidence[],
        count: typeof body.count === "number" ? body.count : body.evidence.length,
        limit: typeof body.limit === "number" ? body.limit : options.limit,
        offset: typeof body.offset === "number" ? body.offset : options.offset,
      };
    },

    getFindings: async (scanId: string): Promise<Finding[]> => {
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}/findings`),
        "findings envelope",
      );
      if (!Array.isArray(body.findings)) throw invalidResponse("findings list is missing");
      return body.findings as Finding[];
    },

    getScanEvents: async (
      scanId: string,
      options: { after: number; limit?: number },
    ): Promise<ScanEventsPage> => {
      const limit = options.limit ?? 500;
      const query = `after=${encodeURIComponent(String(options.after))}&limit=${encodeURIComponent(String(limit))}`;
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}/events?${query}`),
        "events envelope",
      );
      if (!Array.isArray(body.events)) throw invalidResponse("events list is missing");
      const events = body.events.map(expectScanEvent);
      const nextAfter =
        typeof body.nextAfter === "number"
          ? body.nextAfter
          : (events[events.length - 1]?.seq ?? null);
      return { events, nextAfter };
    },

    getScanReport: async (scanId: string): Promise<ScanReport> => {
      const body = expectObject(
        await request<unknown>(`/api/scanner/scans/${encodeURIComponent(scanId)}/report`),
        "report envelope",
      );
      const report = expectObject(body.report, "scan report");
      if (!Array.isArray(report.findings)) throw invalidResponse("report findings are missing");
      const risk = expectObject(report.risk, "report risk");
      if (risk.basis !== "heuristic" || typeof risk.score !== "number") {
        throw invalidResponse("report risk is missing its basis or score");
      }
      return {
        generatedAt: typeof report.generatedAt === "string" ? report.generatedAt : "",
        job: expectScanJob(report.job),
        findings: report.findings as Finding[],
        risk: risk as unknown as IntegrityRisk,
        stats: report.stats as unknown as ScanReportStats,
      };
    },
  };
}

export type ScannerClient = ReturnType<typeof createScannerClient>;

export function isTerminalStatus(status: ScanLifecycleStatus): boolean {
  return TERMINAL_SCAN_STATUSES.includes(status);
}
