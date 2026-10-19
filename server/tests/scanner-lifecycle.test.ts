import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/errors.ts";
import {
  LEGACY_SCAN_STATUS_EQUIVALENT,
  SCAN_LIFECYCLE_STATUSES,
  assertScanTransition,
  canTransitionScanStatus,
  isScanLifecycleStatus,
  isTerminalScanStatus,
  type ScanLifecycleStatus,
} from "../src/scanner/lifecycle.ts";

const VALID_TRANSITIONS: Array<[ScanLifecycleStatus, ScanLifecycleStatus]> = [
  ["QUEUED", "RUNNING"],
  ["QUEUED", "FAILED"],
  ["QUEUED", "CANCELLED"],
  ["RUNNING", "COMPLETED"],
  ["RUNNING", "COMPLETED_WITH_WARNINGS"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "CANCELLED"],
];

const INVALID_TRANSITIONS: Array<[ScanLifecycleStatus, ScanLifecycleStatus]> = [
  ["QUEUED", "COMPLETED"],
  ["QUEUED", "COMPLETED_WITH_WARNINGS"],
  ["QUEUED", "QUEUED"],
  ["RUNNING", "QUEUED"],
  ["RUNNING", "RUNNING"],
  ["COMPLETED", "RUNNING"],
  ["COMPLETED", "FAILED"],
  ["COMPLETED_WITH_WARNINGS", "RUNNING"],
  ["FAILED", "COMPLETED"],
  ["CANCELLED", "RUNNING"],
];

test("all documented lifecycle transitions are accepted", () => {
  for (const [from, to] of VALID_TRANSITIONS) {
    assert.equal(canTransitionScanStatus(from, to), true, `${from} -> ${to}`);
    assertScanTransition(from, to);
  }
});

test("invalid and duplicate transitions are rejected with INVALID_TRANSITION", () => {
  for (const [from, to] of INVALID_TRANSITIONS) {
    assert.equal(canTransitionScanStatus(from, to), false, `${from} -> ${to}`);
    assert.throws(
      () => assertScanTransition(from, to),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "INVALID_TRANSITION" &&
        error.status === 409,
      `${from} -> ${to}`,
    );
  }
});

test("terminal statuses never transition to anything", () => {
  const terminal: ScanLifecycleStatus[] = ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"];
  for (const status of terminal) {
    assert.equal(isTerminalScanStatus(status), true);
    for (const target of SCAN_LIFECYCLE_STATUSES) {
      assert.equal(canTransitionScanStatus(status, target), false, `${status} -> ${target}`);
    }
  }
  assert.equal(isTerminalScanStatus("QUEUED"), false);
  assert.equal(isTerminalScanStatus("RUNNING"), false);
});

test("lifecycle status guard accepts only known statuses", () => {
  for (const status of SCAN_LIFECYCLE_STATUSES) {
    assert.equal(isScanLifecycleStatus(status), true);
  }
  assert.equal(isScanLifecycleStatus("SUCCESS"), false);
  assert.equal(isScanLifecycleStatus("completed"), false);
  assert.equal(isScanLifecycleStatus(""), false);
});

test("legacy scan_jobs status mapping covers every lifecycle status", () => {
  const mapped = Object.keys(LEGACY_SCAN_STATUS_EQUIVALENT).sort();
  assert.deepEqual(mapped, [...SCAN_LIFECYCLE_STATUSES].sort());
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.QUEUED, "queued");
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.RUNNING, "running");
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.COMPLETED, "completed");
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.COMPLETED_WITH_WARNINGS, "completed");
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.FAILED, "failed");
  assert.equal(LEGACY_SCAN_STATUS_EQUIVALENT.CANCELLED, "cancelled");
});
