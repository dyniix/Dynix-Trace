export const SCAN_JOB_STATUSES = [
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ScanJobStatus = (typeof SCAN_JOB_STATUSES)[number];

export const FINDING_STATUSES = [
  "VERIFIED",
  "MODIFIED",
  "SUSPICIOUS",
  "UNKNOWN",
  "CLEAN",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_SEVERITIES = ["info", "low", "medium", "high"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CATEGORIES = [
  "file_integrity",
  "process_metadata",
  "configuration",
  "installation",
  "network_indicator",
  "user_evidence",
  "unknown",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const PLATFORMS = [
  "msi_app_player",
  "bluestacks_5",
  "google_play_games_beta",
] as const;
export type PlatformId = (typeof PLATFORMS)[number];

export const GAME_TARGETS = ["free_fire"] as const;
export type GameTargetId = (typeof GAME_TARGETS)[number];

export type EvidenceRef = {
  id: string;
  kind: "file" | "hash" | "log" | "screenshot" | "upload";
  label: string;
  uri?: string;
  sha256?: string;
};

export type ScanJobError = {
  code: string;
  message: string;
};

export type ScanJob = {
  id: string;
  platform: PlatformId;
  gameTarget: GameTargetId | null;
  status: ScanJobStatus;
  progress: number | null;
  scannerVersion: string | null;
  error: ScanJobError | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type FindingFileMetadata = {
  path: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  expectedSha256: string | null;
  observedSha256: string | null;
};

export type Finding = {
  id: string;
  scanJobId: string;
  category: FindingCategory;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  description: string;
  evidence: EvidenceRef[];
  file: FindingFileMetadata | null;
  confidence: number | null;
  limitations: string[];
  createdAt: string;
};

export type ScanJobInsert = {
  id: string;
  platform: PlatformId;
  gameTarget?: GameTargetId | null;
  status?: ScanJobStatus;
  progress?: number | null;
  scannerVersion?: string | null;
  error?: ScanJobError | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type FindingInsert = {
  id: string;
  scanJobId: string;
  category: FindingCategory;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  description: string;
  evidence?: EvidenceRef[];
  file?: FindingFileMetadata | null;
  confidence?: number | null;
  limitations?: string[];
  createdAt?: string;
};

export const AI_ANALYSIS_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUSES)[number];

export const AI_OPERATION_STATUSES = [
  "ANALYSIS_RUNNING",
  "RATE_LIMIT_WAIT",
  "ANALYSIS_PENDING",
  "AI_TEMPORARILY_UNAVAILABLE",
  "ANALYSIS_COMPLETED",
] as const;
export type AiOperationStatus = (typeof AI_OPERATION_STATUSES)[number];

export type AiAnalysis = {
  id: string;
  scanJobId: string;
  findingId: string | null;
  provider: string;
  model: string;
  status: AiAnalysisStatus;
  promptVersion: string | null;
  inputSummary: string | null;
  outputText: string | null;
  error: ScanJobError | null;
  createdAt: string;
  completedAt: string | null;
};

export type AiAnalysisInsert = {
  id: string;
  scanJobId: string;
  findingId?: string | null;
  provider: string;
  model?: string;
  status?: AiAnalysisStatus;
  promptVersion?: string | null;
  inputSummary?: string | null;
  outputText?: string | null;
  error?: ScanJobError | null;
  createdAt?: string;
  completedAt?: string | null;
};
