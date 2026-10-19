import assert from "node:assert/strict";
import { test } from "node:test";
import { processEvidenceSchema } from "../src/scanner/contracts.ts";
import { normalizeCollection, normalizeProcessRecord } from "../src/scanner/normalize.ts";
import {
  MOCK_COLLECTION_TIMESTAMP,
  MOCK_SCAN_ID,
  mockNormalizeContext,
  mockProcessRecord,
} from "./support/scanner-mocks.ts";

test("a fully readable process normalizes to OBSERVED fields without fabricating anything", () => {
  const record = mockProcessRecord({
    executable: {
      fileSizeBytes: 20480,
      createdAt: "2025-12-01T10:00:00.000Z",
      modifiedAt: "2025-12-02T11:30:00.000Z",
      sha256: "b".repeat(64),
      signatureStatus: "VALID",
      signatureMethod: "windows-authenticode",
      signerName: "Demo Publisher",
    },
  });
  const { evidence, warnings } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.ok(evidence);
  assert.equal(evidence.evidenceId, `${MOCK_SCAN_ID}:proc:4242`);
  assert.deepEqual(evidence.processName, { value: "demo-agent.exe", status: "OBSERVED" });
  assert.deepEqual(evidence.parentProcessId, { value: 1000, status: "OBSERVED" });
  assert.deepEqual(evidence.processStartTime, {
    value: "2026-01-01T00:00:00.000Z",
    status: "OBSERVED",
  });
  assert.equal(evidence.collectionTimestamp, MOCK_COLLECTION_TIMESTAMP);
  assert.equal(evidence.source, "mocked");
  assert.equal(warnings.length, 0);
  assert.ok(evidence.executable);
  assert.deepEqual(evidence.executable.sha256, { value: "b".repeat(64), status: "OBSERVED" });
  assert.deepEqual(evidence.executable.signature, {
    status: "VALID",
    method: "windows-authenticode",
    signerName: "Demo Publisher",
  });
  assert.equal(processEvidenceSchema.safeParse(evidence).success, true);
});

test("missing fields become UNKNOWN with null values, never invented data", () => {
  const record: { processId: number } = { processId: 777 };
  const { evidence } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.ok(evidence);
  assert.deepEqual(evidence.processName, { value: null, status: "UNKNOWN" });
  assert.deepEqual(evidence.parentProcessId, { value: null, status: "UNKNOWN" });
  assert.deepEqual(evidence.processStartTime, { value: null, status: "UNKNOWN" });
  assert.equal(evidence.executablePath.value, null);
  assert.equal(evidence.executablePath.status, "UNKNOWN");
  assert.equal(processEvidenceSchema.safeParse(evidence).success, true);
});

test("field issues are preserved as ACCESS_DENIED and PROCESS_EXITED, not masked", () => {
  const record = mockProcessRecord({
    executablePath: null,
    fieldIssues: { executablePath: "ACCESS_DENIED", processStartTime: "PROCESS_EXITED" },
  });
  const { evidence } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.ok(evidence);
  assert.deepEqual(evidence.executablePath, { value: null, status: "ACCESS_DENIED" });
  assert.deepEqual(evidence.processStartTime, { value: null, status: "PROCESS_EXITED" });
});

test("records with invalid process IDs are excluded with a warning and never guessed", () => {
  for (const processId of [-3, 4.5, Number.NaN]) {
    const { evidence, warnings } = normalizeProcessRecord(
      mockProcessRecord({ processId }),
      mockNormalizeContext(),
    );
    assert.equal(evidence, null);
    assert.equal(warnings[0]?.code, "RAW_RECORD_INVALID");
  }
});

test("invalid raw values are discarded with warnings instead of being persisted", () => {
  const record = mockProcessRecord({
    executable: {
      fileSizeBytes: -5,
      createdAt: "not-a-timestamp",
      modifiedAt: null,
      sha256: "XYZ",
    },
  });
  const { evidence, warnings } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.ok(evidence?.executable);
  assert.deepEqual(evidence.executable.fileSizeBytes, { value: null, status: "UNKNOWN" });
  assert.deepEqual(evidence.executable.createdAt, { value: null, status: "UNKNOWN" });
  assert.deepEqual(evidence.executable.sha256, { value: null, status: "UNKNOWN" });
  const codes = warnings.map((item) => item.code);
  assert.ok(codes.includes("HASH_FAILED"));
  assert.ok(codes.includes("EXECUTABLE_METADATA_UNAVAILABLE"));
  assert.equal(processEvidenceSchema.safeParse(evidence).success, true);
});

test("a signature result without a verification method is downgraded to UNKNOWN", () => {
  const record = mockProcessRecord({
    executable: { signatureStatus: "VALID", signerName: "Demo Publisher" },
  });
  const { evidence, warnings } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.ok(evidence?.executable);
  assert.equal(evidence.executable.signature.status, "UNKNOWN");
  assert.equal(evidence.executable.signature.method, "none");
  assert.equal(evidence.executable.signature.signerName, null);
  assert.equal(warnings[0]?.code, "SIGNATURE_CHECK_UNAVAILABLE");
});

test("an UNSIGNED signature never keeps a signer name", () => {
  const record = mockProcessRecord({
    executable: {
      signatureStatus: "UNSIGNED",
      signatureMethod: "windows-authenticode",
      signerName: "Should Not Survive",
    },
  });
  const { evidence } = normalizeProcessRecord(record, mockNormalizeContext());
  assert.equal(evidence?.executable?.signature.signerName, null);
  assert.equal(evidence?.executable?.signature.status, "UNSIGNED");
});

test("duplicate warnings are aggregated by code with occurrence counts", () => {
  const outcome = {
    records: [
      mockProcessRecord({ processId: 10, executablePath: null }),
      mockProcessRecord({ processId: 11, executablePath: null }),
      mockProcessRecord({ processId: 12 }),
    ],
    attempted: 3,
    completed: 3,
    complete: true,
    warnings: [],
    limitations: [],
  };
  const result = normalizeCollection(outcome, mockNormalizeContext());
  assert.equal(result.processes.length, 3);
  const pathWarning = result.warnings.find((item) => item.code === "EXECUTABLE_PATH_UNAVAILABLE");
  assert.equal(pathWarning?.occurrences, 2);
});

test("a partial inventory is flagged and mocked evidence is explicitly labelled", () => {
  const outcome = {
    records: [mockProcessRecord()],
    attempted: 40,
    completed: 12,
    complete: false,
    warnings: [],
    limitations: ["Collector stopped early."],
  };
  const result = normalizeCollection(outcome, mockNormalizeContext());
  assert.equal(result.warnings.some((item) => item.code === "PARTIAL_INVENTORY"), true);
  assert.equal(
    result.limitations.some((item) => item.includes("Mocked collector")),
    true,
  );
  assert.equal(
    result.limitations.some((item) => item.includes("partial")),
    true,
  );
});

test("an empty process inventory normalizes to a valid empty collection", () => {
  const outcome = {
    records: [],
    attempted: 0,
    completed: 0,
    complete: true,
    warnings: [],
    limitations: [],
  };
  const clean = normalizeCollection(outcome, {
    ...mockNormalizeContext(),
    source: "windows-native",
  });
  assert.deepEqual(clean.processes, []);
  assert.deepEqual(clean.warnings, []);
  assert.deepEqual(clean.limitations, []);

  const mocked = normalizeCollection(outcome, mockNormalizeContext());
  assert.equal(mocked.limitations.length, 1);
  assert.match(mocked.limitations[0] ?? "", /Mocked collector/);
});

test("evidence IDs are deterministic so repeated collections deduplicate", () => {
  const withExecutable = mockProcessRecord({ executable: { fileSizeBytes: 1024 } });
  const first = normalizeProcessRecord(withExecutable, mockNormalizeContext("scan-a"));
  const second = normalizeProcessRecord(withExecutable, mockNormalizeContext("scan-a"));
  const other = normalizeProcessRecord(withExecutable, mockNormalizeContext("scan-b"));
  assert.equal(first.evidence?.evidenceId, second.evidence?.evidenceId);
  assert.notEqual(first.evidence?.evidenceId, other.evidence?.evidenceId);
  assert.equal(first.evidence?.executable?.evidenceId, "scan-a:exec:4242");
});
