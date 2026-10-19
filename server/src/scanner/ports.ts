import type {
  CollectorProvenance,
  Finding,
  ProcessEvidence,
  ScanJob,
  ScanRequest,
  ScanWarning,
  SignatureMethod,
  SignatureStatus,
} from "./contracts.ts";
import type { ScanEvent, ScanEventInput } from "./events.ts";
import type { ScanLifecycleStatus } from "./lifecycle.ts";

export type CollectionContext = {
  readonly signal?: AbortSignal;
  readonly now?: () => string;
};

export const RAW_FIELD_ISSUES = [
  "ACCESS_DENIED",
  "UNAVAILABLE",
  "PROCESS_EXITED",
  "NOT_APPLICABLE",
  "UNKNOWN",
] as const;
export type RawFieldIssue = (typeof RAW_FIELD_ISSUES)[number];

export type RawProcessRecord = {
  processId: number;
  parentProcessId?: number | null;
  processName?: string | null;
  executablePath?: string | null;
  processStartTime?: string | null;
  fieldIssues?: Partial<
    Record<"parentProcessId" | "processName" | "executablePath" | "processStartTime", RawFieldIssue>
  >;
  executable?: RawExecutableMetadata | null;
};

export type RawExecutableMetadata = {
  fileSizeBytes?: number | null;
  createdAt?: string | null;
  modifiedAt?: string | null;
  sha256?: string | null;
  signatureStatus?: SignatureStatus;
  signatureMethod?: SignatureMethod;
  signerName?: string | null;
  fieldIssues?: Partial<
    Record<"fileSizeBytes" | "createdAt" | "modifiedAt" | "sha256", RawFieldIssue>
  >;
};

export type ProcessCollectionOutcome = {
  records: RawProcessRecord[];
  attempted: number;
  completed: number;
  complete: boolean;
  warnings: ScanWarning[];
  limitations: string[];
};

export type ExecutableCollectionOutcome = {
  metadata: RawExecutableMetadata | null;
  warnings: ScanWarning[];
  limitations: string[];
};

/**
 * OS boundary for process inventory. Implementations declare their
 * provenance, so evidence produced through a mocked collector can never be
 * presented as real Windows data.
 */
export interface ProcessInventoryCollector {
  readonly provenance: CollectorProvenance;
  readonly scannerVersion: string;
  collectProcesses(context: CollectionContext): Promise<ProcessCollectionOutcome>;
}

export interface ExecutableMetadataCollector {
  readonly provenance: CollectorProvenance;
  collectExecutableMetadata(input: {
    executablePath: string;
    context: CollectionContext;
  }): Promise<ExecutableCollectionOutcome>;
}

export type ScannerFeatureAvailability = {
  available: boolean;
  reason: string | null;
};

export type ScannerCapabilities = {
  platform: string;
  osSupported: boolean;
  collectorProvenance: CollectorProvenance | null;
  scannerVersion: string | null;
  features: {
    processInventory: ScannerFeatureAvailability;
    executableMetadata: ScannerFeatureAvailability;
    sha256Hashing: ScannerFeatureAvailability;
    signatureVerification: ScannerFeatureAvailability;
  };
  limitations: string[];
};

export interface ScannerCapabilityProvider {
  detectCapabilities(): Promise<ScannerCapabilities>;
}

export type NormalizedCollection = {
  processes: ProcessEvidence[];
  warnings: ScanWarning[];
  limitations: string[];
};

export type FindingEvaluationInput = {
  scanId: string;
  processes: readonly ProcessEvidence[];
};

export type FindingDraft = Omit<Finding, "findingId" | "scanId" | "ruleId" | "createdAt">;

/**
 * Deterministic finding generation boundary. Rules only produce drafts from
 * normalized evidence; identity, scan linkage and timestamps are assigned by
 * the orchestrator. A scan with zero rules produced zero findings is valid.
 */
export interface FindingRule {
  readonly id: string;
  readonly category: Finding["category"];
  evaluate(input: FindingEvaluationInput): FindingDraft[];
}

export type StartScanResult = {
  scanId: string;
  status: ScanLifecycleStatus;
};

export interface ScanOrchestrator {
  startScan(request: ScanRequest): Promise<StartScanResult>;
  cancelScan(scanId: string): Promise<StartScanResult>;
}

/**
 * Persistence boundary for scan jobs and evidence. Implementations must be
 * idempotent for repeated appends of the same evidenceId/findingId and must
 * resolve only after the write is durable.
 */
export interface ScanPersistencePort {
  createJob(job: ScanJob): Promise<void>;
  updateJob(scanId: string, patch: Partial<ScanJob>): Promise<void>;
  getJob(scanId: string): Promise<ScanJob | null>;
  listJobs(input: { limit: number }): Promise<ScanJob[]>;
  appendProcessEvidence(scanId: string, processes: readonly ProcessEvidence[]): Promise<void>;
  appendFindings(scanId: string, findings: readonly Finding[]): Promise<void>;
  listProcessEvidence(scanId: string, input: { limit: number; offset: number }): Promise<ProcessEvidence[]>;
  listFindings(scanId: string): Promise<Finding[]>;
  /**
   * Appends console events to a scan. The sequence number is assigned by
   * the store, so concurrently appended events can never collide.
   */
  appendScanEvents(scanId: string, events: readonly ScanEventInput[]): Promise<void>;
  /** Returns events with seq greater than afterSeq, ordered ascending. */
  listScanEvents(scanId: string, input: { afterSeq: number; limit: number }): Promise<ScanEvent[]>;
}
