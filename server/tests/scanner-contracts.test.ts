import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/errors.ts";
import {
  findingSchema,
  parseFindingContract,
  parseProcessEvidenceContract,
  parseScanJobContract,
  processEvidenceSchema,
  scanJobSchema,
  scanProgressSchema,
  scanRequestSchema,
} from "../src/scanner/contracts.ts";

function validJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scanId: "scan-1",
    status: "QUEUED",
    platform: "win32",
    scannerVersion: "0.1.0",
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
    ...overrides,
  };
}

test("every lifecycle state of a scan job parses when consistent", () => {
  const jobs: unknown[] = [
    validJob(),
    validJob({
      status: "RUNNING",
      startedAt: "2026-01-01T00:00:01.000Z",
      progress: { stage: "ENUMERATING_PROCESSES", stageIndex: 1, totalStages: 6 },
    }),
    validJob({
      status: "COMPLETED",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:09.000Z",
      checksAttempted: 120,
      checksCompleted: 120,
      processCount: 120,
    }),
    validJob({
      status: "COMPLETED_WITH_WARNINGS",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:09.000Z",
      warnings: [
        { code: "PROCESS_ACCESS_DENIED", message: "3 processes were not accessible.", occurrences: 3 },
      ],
    }),
    validJob({
      status: "FAILED",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      error: { code: "COLLECTOR_FAILED", message: "The process collector stopped unexpectedly." },
    }),
    validJob({
      status: "CANCELLED",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
    }),
  ];
  for (const job of jobs) {
    const parsed = scanJobSchema.safeParse(job);
    assert.equal(parsed.success, true, JSON.stringify(job));
  }
});

test("inconsistent scan job states are rejected", () => {
  assert.equal(scanJobSchema.safeParse(validJob({ startedAt: "2026-01-01T00:00:01.000Z" })).success, false);
  assert.equal(
    scanJobSchema.safeParse(validJob({ status: "RUNNING" })).success,
    false,
    "RUNNING without startedAt",
  );
  assert.equal(
    scanJobSchema.safeParse(validJob({ status: "RUNNING", startedAt: "2026-01-01T00:00:01.000Z", completedAt: "2026-01-01T00:00:02.000Z" })).success,
    false,
    "RUNNING with completedAt",
  );
  assert.equal(scanJobSchema.safeParse(validJob({ status: "COMPLETED" })).success, false);
  assert.equal(scanJobSchema.safeParse(validJob({ status: "FAILED", error: null })).success, false);
  assert.equal(
    scanJobSchema.safeParse(validJob({ checksAttempted: 2, checksCompleted: 5 })).success,
    false,
    "completed checks beyond attempted checks",
  );
  assert.equal(scanJobSchema.safeParse(validJob({ status: "SUCCESS" })).success, false);
  assert.equal(
    scanJobSchema.safeParse(validJob({ progress: { stage: "RUNNING", stageIndex: 0, totalStages: 6 } })).success,
    false,
    "unknown stage",
  );
});

test("scan jobs cannot carry unpredictable extra fields such as a percentage", () => {
  assert.equal(scanJobSchema.safeParse({ ...(validJob() as object), percent: 42 }).success, false);
  assert.equal(
    scanJobSchema.safeParse({
      ...(validJob() as object),
      progress: { stage: "INITIALIZING", stageIndex: 0, totalStages: 6, percent: 42 },
    }).success,
    false,
  );
  assert.equal(
    scanProgressSchema.safeParse({ stage: "FINALIZING", stageIndex: 5, totalStages: 6 }).success,
    true,
  );
  assert.equal(
    scanProgressSchema.safeParse({ stage: "FINALIZING", stageIndex: 2, totalStages: 6 }).success,
    false,
    "stageIndex must match the stage",
  );
});

test("a valid process evidence record with executable metadata parses", () => {
  const parsed = parseProcessEvidenceContract({
    evidenceId: "scan-1:proc:4242",
    scanId: "scan-1",
    processId: 4242,
    parentProcessId: { value: 1000, status: "OBSERVED" },
    processName: { value: "demo-agent.exe", status: "OBSERVED" },
    executablePath: { value: "C:\\Demo\\demo-agent.exe", status: "OBSERVED" },
    processStartTime: { value: "2026-01-01T00:00:00.000Z", status: "OBSERVED" },
    collectionTimestamp: "2026-01-01T00:00:05.000Z",
    executable: {
      evidenceId: "scan-1:exec:4242",
      path: "C:\\Demo\\demo-agent.exe",
      fileSizeBytes: { value: 20480, status: "OBSERVED" },
      createdAt: { value: null, status: "UNKNOWN" },
      modifiedAt: { value: null, status: "ACCESS_DENIED" },
      sha256: {
        value: "a".repeat(64),
        status: "OBSERVED",
      },
      signature: { status: "VALID", method: "windows-authenticode", signerName: "Demo Publisher" },
      limitations: [],
    },
    source: "mocked",
    limitations: [],
  });
  assert.equal(parsed.processId, 4242);
});

test("evidence fields cannot claim a value under a non-value status", () => {
  const base = {
    evidenceId: "scan-1:proc:7",
    scanId: "scan-1",
    processId: 7,
    collectionTimestamp: "2026-01-01T00:00:05.000Z",
    executable: null,
    source: "mocked",
    limitations: [],
  };
  const deniedWithValue = {
    ...base,
    parentProcessId: { value: null, status: "UNKNOWN" },
    processName: { value: "x.exe", status: "OBSERVED" },
    executablePath: { value: "C:\\x.exe", status: "ACCESS_DENIED" },
    processStartTime: { value: null, status: "UNKNOWN" },
  };
  assert.equal(processEvidenceSchema.safeParse(deniedWithValue).success, false);

  const observedWithoutValue = {
    ...base,
    parentProcessId: { value: null, status: "UNKNOWN" },
    processName: { value: null, status: "OBSERVED" },
    executablePath: { value: null, status: "UNKNOWN" },
    processStartTime: { value: null, status: "UNKNOWN" },
  };
  assert.equal(processEvidenceSchema.safeParse(observedWithoutValue).success, false);

  const unknownPathWithValue = {
    ...base,
    parentProcessId: { value: null, status: "UNKNOWN" },
    processName: { value: "x.exe", status: "OBSERVED" },
    executablePath: { value: "C:\\x.exe", status: "UNKNOWN" },
    processStartTime: { value: null, status: "UNKNOWN" },
  };
  assert.equal(processEvidenceSchema.safeParse(unknownPathWithValue).success, false);

  const deniedWithoutValue = { ...deniedWithValue, executablePath: { value: null, status: "ACCESS_DENIED" } };
  assert.equal(processEvidenceSchema.safeParse(deniedWithoutValue).success, true);
});

test("hash values must be well-formed lowercase SHA-256 or absent", () => {
  const executable = {
    evidenceId: "scan-1:exec:7",
    path: "C:\\x.exe",
    fileSizeBytes: { value: null, status: "UNKNOWN" },
    createdAt: { value: null, status: "UNKNOWN" },
    modifiedAt: { value: null, status: "UNKNOWN" },
    sha256: { value: "not-a-hash", status: "OBSERVED" },
    signature: { status: "UNKNOWN", method: "none", signerName: null },
    limitations: [],
  };
  const base = {
    evidenceId: "scan-1:proc:7",
    scanId: "scan-1",
    processId: 7,
    parentProcessId: { value: null, status: "UNKNOWN" },
    processName: { value: "x.exe", status: "OBSERVED" },
    executablePath: { value: "C:\\x.exe", status: "OBSERVED" },
    processStartTime: { value: null, status: "UNKNOWN" },
    collectionTimestamp: "2026-01-01T00:00:05.000Z",
    source: "mocked",
    limitations: [],
  };
  assert.equal(processEvidenceSchema.safeParse({ ...base, executable }).success, false);
  assert.equal(
    processEvidenceSchema.safeParse({
      ...base,
      executable: { ...executable, sha256: { value: null, status: "HASH_FAILED" } },
    }).success,
    false,
    "HASH_FAILED is not a field status",
  );
  assert.equal(
    processEvidenceSchema.safeParse({
      ...base,
      executable: { ...executable, sha256: { value: null, status: "UNKNOWN" } },
    }).success,
    true,
  );
});

test("signature statuses stay honest: UNKNOWN is not UNSIGNED and requires a method", () => {
  const unknownSig = { status: "UNKNOWN", method: "none", signerName: null };
  const unsignedSig = { status: "UNSIGNED", method: "windows-authenticode", signerName: null };
  assert.notDeepEqual(unknownSig.status, unsignedSig.status);
  const makeExecutable = (signature: unknown) => ({
    evidenceId: "scan-1:exec:7",
    path: null,
    fileSizeBytes: { value: null, status: "UNKNOWN" },
    createdAt: { value: null, status: "UNKNOWN" },
    modifiedAt: { value: null, status: "UNKNOWN" },
    sha256: { value: null, status: "UNKNOWN" },
    signature,
    limitations: [],
  });
  const base = {
    evidenceId: "scan-1:proc:7",
    scanId: "scan-1",
    processId: 7,
    parentProcessId: { value: null, status: "UNKNOWN" },
    processName: { value: null, status: "UNKNOWN" },
    executablePath: { value: null, status: "UNKNOWN" },
    processStartTime: { value: null, status: "UNKNOWN" },
    collectionTimestamp: "2026-01-01T00:00:05.000Z",
    source: "mocked",
    limitations: [],
  };
  assert.equal(processEvidenceSchema.safeParse({ ...base, executable: makeExecutable(unknownSig) }).success, true);
  assert.equal(processEvidenceSchema.safeParse({ ...base, executable: makeExecutable(unsignedSig) }).success, true);
  assert.equal(
    processEvidenceSchema.safeParse({
      ...base,
      executable: makeExecutable({ status: "UNSIGNED", method: "windows-authenticode", signerName: "Acme Corp" }),
    }).success,
    false,
    "unsigned executable with a signer name",
  );
  assert.equal(
    processEvidenceSchema.safeParse({
      ...base,
      executable: makeExecutable({ status: "VALID", method: "none", signerName: null }),
    }).success,
    false,
    "signature result without a verification method",
  );
  assert.equal(
    processEvidenceSchema.safeParse({
      ...base,
      executable: makeExecutable({ status: "UNKNOWN", method: "none", signerName: "Acme Corp" }),
    }).success,
    false,
    "signer name on an unknown signature",
  );
});

test("findings require evidence references and stay inside the known vocabularies", () => {
  const valid = {
    findingId: "finding-1",
    scanId: "scan-1",
    ruleId: "rule-demo",
    category: "process_metadata",
    title: "Demo finding",
    description: "A neutral description of what was observed.",
    severity: "low",
    verificationStatus: "INFERRED",
    evidenceReferences: [{ kind: "process", refId: "scan-1:proc:4242", label: "demo-agent.exe (PID 4242)" }],
    limitations: ["Only running processes were inspected."],
    alternativeExplanations: ["The executable may be part of a legitimate application."],
    createdAt: "2026-01-01T00:00:06.000Z",
  };
  assert.equal(findingSchema.safeParse(valid).success, true);
  assert.equal(
    findingSchema.safeParse({ ...valid, evidenceReferences: [] }).success,
    false,
    "a finding without evidence references",
  );
  assert.equal(findingSchema.safeParse({ ...valid, category: "telemetry_data" }).success, false);
  assert.equal(findingSchema.safeParse({ ...valid, severity: "critical" }).success, false);
  assert.equal(findingSchema.safeParse({ ...valid, verificationStatus: "PROBABLY" }).success, false);
});

test("scan requests cannot carry commands or executable paths", () => {
  assert.equal(scanRequestSchema.safeParse({}).success, true);
  assert.equal(scanRequestSchema.safeParse({ command: "whoami" }).success, false);
  assert.equal(scanRequestSchema.safeParse({ executablePath: "C:\\tools\\run.exe" }).success, false);
});

test("contract parse helpers raise explicit AppErrors for invalid data", () => {
  assert.throws(
    () => parseScanJobContract(validJob({ checksAttempted: 1, checksCompleted: 9 })),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_SCAN_JOB_CONTRACT" &&
      Array.isArray(error.details),
  );
  assert.throws(
    () => parseProcessEvidenceContract({ processId: -1 }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_PROCESS_EVIDENCE_CONTRACT",
  );
  assert.throws(
    () => parseFindingContract({ findingId: "f" }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_FINDING_CONTRACT",
  );
});
