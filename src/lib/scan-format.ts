import {
  SCAN_PROGRESS_STAGES,
  type EvidenceFieldStatus,
  type ScanLifecycleStatus,
  type ScanProgressStage,
  type SignatureStatus,
} from "@/lib/scanner-api";

const STATUS_LABELS: Record<ScanLifecycleStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  COMPLETED_WITH_WARNINGS: "Completed with warnings",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function scanStatusLabel(status: ScanLifecycleStatus): string {
  return STATUS_LABELS[status];
}

const STAGE_LABELS: Record<ScanProgressStage, string> = {
  INITIALIZING: "Initializing",
  ENUMERATING_PROCESSES: "Enumerating processes",
  COLLECTING_PROCESS_METADATA: "Collecting process metadata",
  INSPECTING_EXECUTABLES: "Inspecting executables",
  PERSISTING_EVIDENCE: "Persisting evidence",
  FINALIZING: "Finalizing",
};

export function scanStageLabel(stage: ScanProgressStage): string {
  return STAGE_LABELS[stage];
}

export function scanStagePosition(stage: ScanProgressStage): number {
  return SCAN_PROGRESS_STAGES.indexOf(stage) + 1;
}

export function scanStageTotal(): number {
  return SCAN_PROGRESS_STAGES.length;
}

const FIELD_STATUS_LABELS: Partial<Record<EvidenceFieldStatus, string>> = {
  ACCESS_DENIED: "Access denied",
  UNAVAILABLE: "Unavailable",
  PROCESS_EXITED: "Process exited",
  NOT_APPLICABLE: "Not applicable",
  UNKNOWN: "Unknown",
  INFERRED: "Inferred",
};

export function fieldStatusLabel(status: EvidenceFieldStatus): string {
  return FIELD_STATUS_LABELS[status] ?? status;
}

export function fieldNeedsAttention(status: EvidenceFieldStatus): boolean {
  return status === "ACCESS_DENIED" || status === "UNAVAILABLE" || status === "PROCESS_EXITED";
}

const SIGNATURE_LABELS: Record<SignatureStatus, string> = {
  VALID: "Signed",
  INVALID: "Signature invalid",
  UNSIGNED: "Unsigned",
  UNKNOWN: "Signature unknown",
  UNAVAILABLE: "Signature unavailable",
};

export function signatureStatusLabel(status: SignatureStatus): string {
  return SIGNATURE_LABELS[status];
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatTimestamp(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (startedAt === null || completedAt === null) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function shortHash(value: string | null, length: number = 16): string {
  if (value === null) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
