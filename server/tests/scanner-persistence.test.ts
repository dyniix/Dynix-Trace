import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.ts";
import { insertScanJob } from "../src/repositories.ts";
import { scanJobSchema, type ScanJob } from "../src/scanner/contracts.ts";
import { createScannerPersistence, ensureScannerSchema } from "../src/scanner/persistence.ts";
import { mockProcessRecord } from "./support/scanner-mocks.ts";
import { normalizeProcessRecord } from "../src/scanner/normalize.ts";

function openScannerDb(): DatabaseSync {
  const db = openDatabase(":memory:");
  ensureScannerSchema(db);
  return db;
}

function baseJob(overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    scanId: "scan-persist-1",
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
    ...overrides,
  };
}

function evidenceFor(scanId: string, processId: number) {
  const normalized = normalizeProcessRecord(
    mockProcessRecord({ processId, executablePath: `C:\\Demo\\proc-${processId}.exe` }),
    { scanId, collectionTimestamp: "2026-01-01T00:00:00.000Z", source: "mocked" },
  );
  assert.ok(normalized.evidence);
  return normalized.evidence;
}

test("the scanner schema is additive and never touches legacy tables", () => {
  const db = openScannerDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as Array<{ name: string }>;
  const names = tables.map((row) => row.name);
  for (const expected of ["scan_jobs", "findings", "ai_analyses", "scanner_jobs", "scan_process_evidence", "scanner_findings"]) {
    assert.equal(names.includes(expected), true, `missing table ${expected}`);
  }
  const legacy = insertScanJob(db, {
    id: "legacy-1",
    platform: "bluestacks_5",
    status: "queued",
  });
  assert.equal(legacy.platform, "bluestacks_5");
  db.close();
});

test("jobs round-trip through the persistence port", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  const loaded = await persistence.getJob("scan-persist-1");
  assert.ok(loaded);
  assert.equal(loaded.status, "QUEUED");
  assert.equal(scanJobSchema.safeParse(loaded).success, true);

  await persistence.updateJob("scan-persist-1", {
    status: "RUNNING",
    startedAt: "2026-01-01T00:00:01.000Z",
    progress: { stage: "ENUMERATING_PROCESSES", stageIndex: 1, totalStages: 6 },
  });
  const running = await persistence.getJob("scan-persist-1");
  assert.equal(running?.status, "RUNNING");
  assert.equal(running?.progress?.stage, "ENUMERATING_PROCESSES");
  assert.equal(running?.progress?.stageIndex, 1);
  db.close();
});

test("updateJob refuses patches that would violate the job contract", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  await assert.rejects(
    () => persistence.updateJob("scan-persist-1", { status: "FAILED" }),
    "a FAILED job without an error reason must be rejected",
  );
  await assert.rejects(
    () => persistence.updateJob("scan-persist-1", { checksCompleted: 5, checksAttempted: 1 }),
    "completed checks exceeding attempted checks must be rejected",
  );
  db.close();
});

test("createJob refuses duplicate scan ids", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  await assert.rejects(() => persistence.createJob(baseJob()));
  db.close();
});

test("evidence appends are idempotent by evidence id", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  const evidence = evidenceFor("scan-persist-1", 4242);
  await persistence.appendProcessEvidence("scan-persist-1", [evidence]);
  await persistence.appendProcessEvidence("scan-persist-1", [evidence]);
  const list = await persistence.listProcessEvidence("scan-persist-1", { limit: 50, offset: 0 });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.evidenceId, "scan-persist-1:proc:4242");
  assert.equal(list[0]?.source, "mocked");
  db.close();
});

test("evidence listing is ordered and paginated", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  const evidence = [9, 3, 77].map((id) => evidenceFor("scan-persist-1", id));
  await persistence.appendProcessEvidence("scan-persist-1", evidence);

  const page1 = await persistence.listProcessEvidence("scan-persist-1", { limit: 2, offset: 0 });
  const page2 = await persistence.listProcessEvidence("scan-persist-1", { limit: 2, offset: 2 });
  assert.deepEqual(
    page1.map((item) => item.processId),
    [3, 9],
  );
  assert.deepEqual(
    page2.map((item) => item.processId),
    [77],
  );
  db.close();
});

test("finding appends are idempotent and contract-validated", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  const finding = {
    findingId: "scan-persist-1:finding:0",
    scanId: "scan-persist-1",
    ruleId: "test-rule",
    category: "process_metadata" as const,
    title: "Demo finding",
    description: "A demo finding used to test persistence.",
    severity: "info" as const,
    verificationStatus: "OBSERVED" as const,
    evidenceReferences: [{ kind: "process" as const, refId: "scan-persist-1:proc:4242", label: "process 4242" }],
    limitations: [],
    alternativeExplanations: [],
    createdAt: "2026-01-01T00:00:02.000Z",
  };
  await persistence.appendFindings("scan-persist-1", [finding]);
  await persistence.appendFindings("scan-persist-1", [finding]);
  const findings = await persistence.listFindings("scan-persist-1");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.ruleId, "test-rule");

  await assert.rejects(
    () =>
      persistence.appendFindings("scan-persist-1", [
        { ...finding, findingId: "scan-persist-1:finding:1", evidenceReferences: [] },
      ]),
    "a finding without evidence references must be rejected",
  );
  db.close();
});

test("job listing returns newest first and respects the limit", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob({ scanId: "scan-old", createdAt: "2026-01-01T00:00:00.000Z" }));
  await persistence.createJob(baseJob({ scanId: "scan-new", createdAt: "2026-01-02T00:00:00.000Z" }));
  const listed = await persistence.listJobs({ limit: 10 });
  assert.deepEqual(
    listed.map((job) => job.scanId),
    ["scan-new", "scan-old"],
  );
  const limited = await persistence.listJobs({ limit: 1 });
  assert.equal(limited.length, 1);
  db.close();
});

test("corrupted stored rows surface as errors instead of silent defaults", async () => {
  const db = openScannerDb();
  const persistence = createScannerPersistence(db);
  await persistence.createJob(baseJob());
  db.prepare("UPDATE scanner_jobs SET warnings_json = ? WHERE scan_id = ?").run(
    JSON.stringify([{ code: "NOT_A_REAL_CODE", message: "x", occurrences: 1 }]),
    "scan-persist-1",
  );
  await assert.rejects(() => persistence.getJob("scan-persist-1"));
  db.close();
});
