import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db.ts";
import type { Finding, ProcessEvidence } from "../src/scanner/contracts.ts";
import { createScannerPersistence, ensureScannerSchema } from "../src/scanner/persistence.ts";
import { normalizeProcessRecord } from "../src/scanner/normalize.ts";
import {
  classifyExecutablePath,
  createDefaultFindingRules,
  createMasqueradingBinaryRule,
  createTempLocationRule,
  createUnsignedUserLocationRule,
  MASQUERADING_RULE_ID,
  TEMP_LOCATION_RULE_ID,
  UNSIGNED_USER_LOCATION_RULE_ID,
  type PathOptions,
} from "../src/scanner/analysis/rules.ts";
import { computeIntegrityRisk } from "../src/scanner/analysis/risk.ts";
import { buildScanReport, summarizeEvidence } from "../src/scanner/analysis/report.ts";
import { mockNormalizeContext, mockProcessRecord } from "./support/scanner-mocks.ts";

const MOCK_SCAN = "scan-analysis-1";

const PATHS: PathOptions = {
  systemRoot: "C:\\Windows",
  userProfile: "C:\\Users\\tester",
  tempRoots: ["C:\\Users\\tester\\AppData\\Local\\Temp", "C:\\Windows\\Temp"],
};

function evidenceFor(options: {
  processId: number;
  processName?: string;
  path: string;
  signature?: { status: "VALID" | "INVALID" | "UNSIGNED"; method?: "windows-authenticode" };
  sha256?: string | null;
  hasExecutable?: boolean;
}): ProcessEvidence {
  const record = mockProcessRecord({
    processId: options.processId,
    processName: options.processName ?? "app.exe",
    executablePath: options.path,
    executable:
      options.hasExecutable === false
        ? null
        : options.signature
          ? {
              signatureStatus: options.signature.status,
              signatureMethod: options.signature.method ?? "windows-authenticode",
              signerName: null,
              sha256: options.sha256 === undefined ? "a".repeat(64) : options.sha256,
            }
          : null,
  });
  const normalized = normalizeProcessRecord(record, mockNormalizeContext(MOCK_SCAN));
  assert.equal(normalized.evidence !== null, true, `fixture did not normalize: ${options.path}`);
  return normalized.evidence as ProcessEvidence;
}

function evaluate(rule: ReturnType<typeof createMasqueradingBinaryRule>, processes: ProcessEvidence[]) {
  return rule.evaluate({ scanId: MOCK_SCAN, processes });
}

// ── path classification ──

test("path classification separates temp, user-writable, system and other locations", () => {
  const resolved = {
    systemRoot: PATHS.systemRoot ?? null,
    userProfile: PATHS.userProfile ?? null,
    tempRoots: PATHS.tempRoots ?? [],
  };
  assert.equal(
    classifyExecutablePath("C:\\Users\\tester\\AppData\\Local\\Temp\\a.exe", resolved),
    "temp",
  );
  assert.equal(classifyExecutablePath("C:\\Windows\\Temp\\a.exe", resolved), "temp");
  assert.equal(classifyExecutablePath("C:\\Users\\tester\\Downloads\\a.exe", resolved), "user-writable");
  assert.equal(classifyExecutablePath("C:\\Users\\Public\\a.exe", resolved), "user-writable");
  assert.equal(classifyExecutablePath("C:\\ProgramData\\tool\\a.exe", resolved), "user-writable");
  assert.equal(classifyExecutablePath("C:\\Windows\\System32\\svchost.exe", resolved), "system");
  assert.equal(classifyExecutablePath("C:\\Program Files\\App\\a.exe", resolved), "other");
  // Prefix matching must be segment-aware, not string-prefix.
  assert.equal(classifyExecutablePath("C:\\Windowsish\\a.exe", resolved), "other");
  assert.equal(classifyExecutablePath("C:\\Users\\tester2\\a.exe", resolved), "other");
  // Slashes and casing normalize.
  assert.equal(classifyExecutablePath("c:/WINDOWS/SYSTEM32/x.exe", resolved), "system");
});

// ── R1 masquerading ──

test("R1 flags a system binary name running from outside the system directories", () => {
  const rule = createMasqueradingBinaryRule(PATHS);
  const processes = [
    evidenceFor({
      processId: 10,
      processName: "svchost.exe",
      path: "C:\\Users\\tester\\Downloads\\svchost.exe",
    }),
  ];
  const drafts = evaluate(rule, processes);
  assert.equal(drafts.length, 1);
  const draft = drafts[0]!;
  assert.equal(draft.severity, "high");
  assert.equal(draft.category, "process_metadata");
  assert.equal(draft.verificationStatus, "INFERRED");
  assert.ok(draft.title.includes("svchost.exe"));
  assert.ok(draft.description.includes("C:\\Users\\tester\\Downloads\\svchost.exe"));
  assert.ok(draft.evidenceReferences.length >= 1);
  assert.ok(draft.evidenceReferences[0]!.label.includes("C:\\Users\\tester\\Downloads\\svchost.exe"));
  assert.ok(draft.alternativeExplanations.length > 0);
});

test("R1 does not flag system binaries in their real homes", () => {
  const rule = createMasqueradingBinaryRule(PATHS);
  const processes = [
    evidenceFor({ processId: 1, processName: "svchost.exe", path: "C:\\Windows\\System32\\svchost.exe" }),
    evidenceFor({ processId: 2, processName: "explorer.exe", path: "C:\\Windows\\explorer.exe" }),
    evidenceFor({ processId: 3, processName: "cmd.exe", path: "C:\\Users\\tester\\Downloads\\cmd.exe" }),
  ];
  assert.equal(evaluate(rule, processes).length, 0);
});

test("R1 groups processes that share one masquerading path into a single finding", () => {
  const rule = createMasqueradingBinaryRule(PATHS);
  const processes = [
    evidenceFor({ processId: 10, processName: "csrss.exe", path: "D:\\fake\\csrss.exe" }),
    evidenceFor({ processId: 11, processName: "CSRSS.EXE", path: "D:\\FAKE\\csrss.exe" }),
  ];
  const drafts = evaluate(rule, processes);
  assert.equal(drafts.length, 1);
  assert.ok(drafts[0]!.evidenceReferences[0]!.label.includes("PID 10, 11"));
});

// ── R2 unsigned in user-writable / temp locations ──

test("R2 flags unsigned and invalid executables in user-writable and temp locations as high", () => {
  const rule = createUnsignedUserLocationRule(PATHS);
  const processes = [
    evidenceFor({
      processId: 20,
      processName: "tool.exe",
      path: "C:\\Users\\tester\\Downloads\\tool.exe",
      signature: { status: "UNSIGNED" },
    }),
    evidenceFor({
      processId: 21,
      processName: "loader.exe",
      path: "C:\\Users\\tester\\AppData\\Local\\Temp\\loader.exe",
      signature: { status: "INVALID" },
    }),
  ];
  const drafts = evaluate(rule, processes);
  assert.equal(drafts.length, 2);
  for (const draft of drafts) {
    assert.equal(draft.severity, "high");
    assert.equal(draft.verificationStatus, "VERIFIED");
    assert.equal(draft.category, "file_integrity");
  }
});

test("R2 stays silent for signed executables, system locations and unchecked files", () => {
  const rule = createUnsignedUserLocationRule(PATHS);
  const processes = [
    evidenceFor({
      processId: 30,
      processName: "signed.exe",
      path: "C:\\Users\\tester\\Downloads\\signed.exe",
      signature: { status: "VALID" },
    }),
    evidenceFor({
      processId: 31,
      processName: "unchecked.exe",
      path: "C:\\Users\\tester\\Downloads\\unchecked.exe",
    }),
    evidenceFor({
      processId: 32,
      processName: "tool.exe",
      path: "C:\\Program Files\\Tool\\tool.exe",
      signature: { status: "UNSIGNED" },
    }),
  ];
  assert.equal(evaluate(rule, processes).length, 0);
});

// ── R3 temp locations ──

test("R3 flags signed, unknown and unchecked executables in temp directories as medium", () => {
  const rule = createTempLocationRule(PATHS);
  const processes = [
    evidenceFor({
      processId: 40,
      processName: "setup.exe",
      path: "C:\\Windows\\Temp\\setup.exe",
      signature: { status: "VALID" },
    }),
    evidenceFor({
      processId: 41,
      processName: "mystery.exe",
      path: "C:\\Users\\tester\\AppData\\Local\\Temp\\mystery.exe",
      hasExecutable: false,
    }),
  ];
  const drafts = evaluate(rule, processes);
  assert.equal(drafts.length, 2);
  for (const draft of drafts) {
    assert.equal(draft.severity, "medium");
    assert.equal(draft.verificationStatus, "OBSERVED");
  }
});

test("R3 does not double-report temp executables already flagged by R2", () => {
  const processes = [
    evidenceFor({
      processId: 50,
      processName: "loader.exe",
      path: "C:\\Users\\tester\\AppData\\Local\\Temp\\loader.exe",
      signature: { status: "UNSIGNED" },
    }),
  ];
  const rules = createDefaultFindingRules(PATHS);
  const allDrafts = rules.flatMap((rule) => evaluate(rule as never, processes));
  assert.equal(allDrafts.length, 1);
});

// ── risk score ──

function findingFor(ruleId: string, severity: Finding["severity"] = "high"): Finding {
  return {
    findingId: `${MOCK_SCAN}:finding:${Math.random().toString(36).slice(2, 8)}`,
    scanId: MOCK_SCAN,
    ruleId,
    category: "file_integrity",
    title: "Fixture finding",
    description: "Fixture finding used to test the deterministic risk score.",
    severity,
    verificationStatus: "OBSERVED",
    evidenceReferences: [{ kind: "process", refId: "ref", label: "ref" }],
    limitations: [],
    alternativeExplanations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("the risk score is a transparent capped sum over known rules", () => {
  const empty = computeIntegrityRisk([]);
  assert.equal(empty.score, 0);
  assert.equal(empty.band, "LOW");
  assert.equal(empty.basis, "heuristic");
  assert.deepEqual(empty.factors, []);

  const twoUnsigned = computeIntegrityRisk([
    findingFor(UNSIGNED_USER_LOCATION_RULE_ID),
    findingFor(UNSIGNED_USER_LOCATION_RULE_ID),
  ]);
  assert.equal(twoUnsigned.score, 24);
  assert.equal(twoUnsigned.band, "MODERATE");
  assert.equal(twoUnsigned.factors.length, 1);
  assert.equal(twoUnsigned.factors[0]!.occurrences, 2);

  const unknownRule = computeIntegrityRisk([findingFor("some-other-rule")]);
  assert.equal(unknownRule.score, 0);

  const masqueradeCap = computeIntegrityRisk(
    Array.from({ length: 10 }, () => findingFor(MASQUERADING_RULE_ID)),
  );
  assert.equal(masqueradeCap.factors[0]!.points, 50);

  const everything = computeIntegrityRisk([
    ...Array.from({ length: 10 }, () => findingFor(MASQUERADING_RULE_ID)),
    ...Array.from({ length: 10 }, () => findingFor(UNSIGNED_USER_LOCATION_RULE_ID)),
    ...Array.from({ length: 10 }, () => findingFor(TEMP_LOCATION_RULE_ID, "medium")),
  ]);
  assert.equal(everything.score, 100);
  assert.equal(everything.band, "HIGH");
});

// ── report stats ──

test("report statistics count signatures, hashes and locations from evidence only", () => {
  const evidence = [
    evidenceFor({
      processId: 1,
      path: "C:\\Windows\\System32\\svchost.exe",
      signature: { status: "VALID" },
    }),
    evidenceFor({
      processId: 2,
      path: "C:\\Users\\tester\\Downloads\\tool.exe",
      signature: { status: "UNSIGNED" },
      sha256: null,
    }),
    evidenceFor({
      processId: 3,
      path: "C:\\Users\\tester\\AppData\\Local\\Temp\\loader.exe",
      hasExecutable: false,
    }),
    evidenceFor({
      processId: 4,
      path: "C:\\Program Files\\App\\app.exe",
      signature: { status: "INVALID" },
    }),
  ];
  const stats = summarizeEvidence(evidence, PATHS);
  assert.deepEqual(stats.signatures, {
    valid: 1,
    unsigned: 1,
    invalid: 1,
    unknown: 0,
    unavailable: 0,
    notChecked: 1,
  });
  assert.equal(stats.hashes.present, 2);
  assert.equal(stats.hashes.missing, 2);
  assert.equal(stats.paths.system, 1);
  assert.equal(stats.paths.userWritable, 1);
  assert.equal(stats.paths.temp, 1);
  assert.equal(stats.paths.other, 1);
  assert.equal(stats.evidenceRecords, 4);
});

test("the report combines job, findings, risk and stats without inventing data", () => {
  const evidence = [
    evidenceFor({
      processId: 2,
      path: "C:\\Users\\tester\\Downloads\\tool.exe",
      signature: { status: "UNSIGNED" },
    }),
  ];
  const findings = [findingFor(UNSIGNED_USER_LOCATION_RULE_ID)];
  const report = buildScanReport({
    job: {
      scanId: MOCK_SCAN,
      status: "COMPLETED",
      platform: "win32",
      scannerVersion: "test",
      collectorProvenance: "mocked",
      progress: null,
      checksAttempted: 1,
      checksCompleted: 1,
      processCount: 1,
      findingsCount: 1,
      warnings: [],
      limitations: [],
      error: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
    },
    findings,
    evidence,
    evidenceTruncated: false,
    generatedAt: "2026-01-01T00:00:03.000Z",
    pathOptions: PATHS,
  });
  assert.equal(report.risk.basis, "heuristic");
  assert.equal(report.risk.score, 12);
  assert.equal(report.stats.evidenceRecords, 1);
  assert.equal(report.findings.length, 1);
});

// ── scan events persistence ──

test("scan events round-trip with store-assigned sequence numbers and after-cursor reads", async () => {
  const db = openDatabase(":memory:");
  ensureScannerSchema(db);
  const persistence = createScannerPersistence(db);
  await persistence.createJob({
    scanId: MOCK_SCAN,
    status: "QUEUED",
    platform: "win32",
    scannerVersion: "mock",
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

  await persistence.appendScanEvents(MOCK_SCAN, [
    { kind: "command", text: "dynix-trace scan", createdAt: "2026-01-01T00:00:01.000Z" },
    { kind: "info", text: "collector mocked", createdAt: "2026-01-01T00:00:02.000Z" },
  ]);
  await persistence.appendScanEvents(MOCK_SCAN, [
    { kind: "risk", text: "HIGH · unsigned tool.exe", createdAt: "2026-01-01T00:00:03.000Z" },
  ]);

  const all = await persistence.listScanEvents(MOCK_SCAN, { afterSeq: 0, limit: 10 });
  assert.deepEqual(
    all.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.equal(all[2]!.kind, "risk");

  const tail = await persistence.listScanEvents(MOCK_SCAN, { afterSeq: 2, limit: 10 });
  assert.equal(tail.length, 1);
  assert.equal(tail[0]!.text, "HIGH · unsigned tool.exe");

  const other = await persistence.listScanEvents("scan-other", { afterSeq: 0, limit: 10 });
  assert.deepEqual(other, []);

  db.close();
});
