import { AppError } from "../errors.ts";

export const SCAN_LIFECYCLE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
] as const;
export type ScanLifecycleStatus = (typeof SCAN_LIFECYCLE_STATUSES)[number];

const TERMINAL_STATUSES: readonly ScanLifecycleStatus[] = [
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
  "CANCELLED",
];

/**
 * Valid scan-job transitions.
 *
 * - QUEUED may start (RUNNING), be cancelled before starting, or fail while
 *   still queued (for example when capacity or setup checks fail).
 * - RUNNING may finish with or without warnings, fail, or be cancelled.
 * - COMPLETED, COMPLETED_WITH_WARNINGS, FAILED and CANCELLED are terminal:
 *   no further transitions are allowed.
 */
const TRANSITIONS: Record<ScanLifecycleStatus, readonly ScanLifecycleStatus[]> = {
  QUEUED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"],
  COMPLETED: [],
  COMPLETED_WITH_WARNINGS: [],
  FAILED: [],
  CANCELLED: [],
};

export function isScanLifecycleStatus(value: string): value is ScanLifecycleStatus {
  return (SCAN_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function isTerminalScanStatus(status: ScanLifecycleStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransitionScanStatus(
  from: ScanLifecycleStatus,
  to: ScanLifecycleStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Throws an AppError (409 INVALID_TRANSITION) when the transition is not
 * allowed. Terminal jobs never transition again, so a duplicate completion
 * or a late cancel request cannot rewrite a finished scan.
 */
export function assertScanTransition(
  from: ScanLifecycleStatus,
  to: ScanLifecycleStatus,
): void {
  if (!canTransitionScanStatus(from, to)) {
    throw new AppError(
      "INVALID_TRANSITION",
      409,
      `Scan cannot move from ${from} to ${to}.`,
    );
  }
}

/**
 * Transitional mapping onto the existing SQLite `scan_jobs.status` CHECK
 * constraint (queued, claimed, running, completed, failed, cancelled).
 * COMPLETED_WITH_WARNINGS is lossy here; Part 3 owns the additive migration.
 * The legacy "claimed" value has no equivalent in the new lifecycle.
 */
export const LEGACY_SCAN_STATUS_EQUIVALENT: Record<ScanLifecycleStatus, string> = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  COMPLETED_WITH_WARNINGS: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};
