import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db.ts";
import {
  getScanJob,
  insertAiAnalysis,
  insertFinding,
  insertScanJob,
  listAiAnalysesByJob,
  listFindingsByJob,
  listScanJobs,
} from "../src/repositories.ts";

test("schema initializes and scan jobs round-trip", () => {
  const db = openDatabase(":memory:");
  try {
    const job = insertScanJob(db, {
      id: "job-1",
      platform: "msi_app_player",
      gameTarget: "free_fire",
      status: "queued",
    });
    assert.equal(job.id, "job-1");
    assert.equal(job.status, "queued");
    assert.equal(job.gameTarget, "free_fire");
    assert.equal(job.error, null);

    const fetched = getScanJob(db, "job-1");
    assert.equal(fetched?.platform, "msi_app_player");
    assert.equal(listScanJobs(db).length, 1);
    assert.equal(getScanJob(db, "missing"), null);
  } finally {
    db.close();
  }
});

test("findings round-trip with evidence, file metadata, and limitations", () => {
  const db = openDatabase(":memory:");
  try {
    insertScanJob(db, { id: "job-2", platform: "bluestacks_5", gameTarget: "free_fire" });
    const finding = insertFinding(db, {
      id: "finding-1",
      scanJobId: "job-2",
      category: "file_integrity",
      severity: "medium",
      status: "MODIFIED",
      title: "Modified game executable",
      description: "Observed hash differs from the expected reference.",
      evidence: [{ id: "ev-1", kind: "hash", label: "Observed SHA-256", sha256: "a".repeat(64) }],
      file: {
        path: "C:\\Games\\FreeFire\\app.exe",
        sizeBytes: 123456,
        modifiedAt: "2026-10-01T10:00:00.000Z",
        expectedSha256: "b".repeat(64),
        observedSha256: "a".repeat(64),
      },
      confidence: 0.82,
      limitations: ["Hash comparison relied on a single reference build."],
    });

    assert.equal(finding.status, "MODIFIED");
    assert.equal(finding.evidence.length, 1);

    const listed = listFindingsByJob(db, "job-2");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].file?.path, "C:\\Games\\FreeFire\\app.exe");
    assert.deepEqual(listed[0].limitations, ["Hash comparison relied on a single reference build."]);
  } finally {
    db.close();
  }
});

test("deleting a scan job cascades to its findings", () => {
  const db = openDatabase(":memory:");
  try {
    insertScanJob(db, { id: "job-3", platform: "google_play_games_beta", gameTarget: "free_fire" });
    insertFinding(db, {
      id: "finding-3",
      scanJobId: "job-3",
      category: "configuration",
      severity: "info",
      status: "UNKNOWN",
      title: "Unreadable setting",
      description: "Configuration value could not be interpreted.",
    });
    assert.equal(listFindingsByJob(db, "job-3").length, 1);

    db.prepare("DELETE FROM scan_jobs WHERE id = ?").run("job-3");
    assert.equal(listFindingsByJob(db, "job-3").length, 0);
  } finally {
    db.close();
  }
});

test("the database enforces the finding status enum", () => {
  const db = openDatabase(":memory:");
  try {
    insertScanJob(db, { id: "job-4", platform: "msi_app_player", gameTarget: "free_fire" });
    assert.throws(() =>
      insertFinding(db, {
        id: "finding-4",
        scanJobId: "job-4",
        category: "unknown",
        severity: "info",
        status: "MAYBE" as never,
        title: "Invalid status",
        description: "Insert must fail.",
      }),
    );
  } finally {
    db.close();
  }
});

test("AI analysis records round-trip and are removed with their scan job", () => {
  const db = openDatabase(":memory:");
  try {
    insertScanJob(db, { id: "job-5", platform: "msi_app_player", gameTarget: "free_fire" });
    insertFinding(db, {
      id: "finding-5",
      scanJobId: "job-5",
      category: "file_integrity",
      severity: "low",
      status: "UNKNOWN",
      title: "Unreviewed artifact",
      description: "Awaiting analysis.",
    });

    const analysis = insertAiAnalysis(db, {
      id: "analysis-1",
      scanJobId: "job-5",
      findingId: "finding-5",
      provider: "openai",
      model: "gpt-4o-mini",
      status: "completed",
      promptVersion: "v0",
      inputSummary: "1 finding submitted for review.",
      outputText: "No additional concerns found in the provided summary.",
    });

    assert.equal(analysis.status, "completed");
    assert.equal(analysis.findingId, "finding-5");
    assert.equal(analysis.error, null);
    assert.equal(listAiAnalysesByJob(db, "job-5").length, 1);

    db.prepare("DELETE FROM scan_jobs WHERE id = ?").run("job-5");
    assert.equal(listAiAnalysesByJob(db, "job-5").length, 0);
  } finally {
    db.close();
  }
});

test("the schema is safe to initialize twice on the same file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dynix-trace-db-"));
  try {
    const path = join(dir, "test.sqlite");
    const first = openDatabase(path);
    insertScanJob(first, { id: "job-a", platform: "msi_app_player" });
    first.close();

    const second = openDatabase(path);
    assert.equal(listScanJobs(second).length, 1);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
