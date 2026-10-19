import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import { readEnv } from "../src/env.ts";
import type { ProcessInventoryCollector } from "../src/scanner/ports.ts";
import { createMockProcessCollector, mockProcessRecord } from "./support/scanner-mocks.ts";
import { createTestApp, waitForTerminalScan } from "./helpers.ts";

const MOCK_COLLECTOR = () =>
  createMockProcessCollector([
    mockProcessRecord({ processId: 100, executablePath: "C:\\Demo\\one.exe" }),
    mockProcessRecord({ processId: 200, executablePath: "C:\\Demo\\two.exe" }),
  ]);

test("a scan can be started, followed and read back through the API", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const started = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    assert.equal(started.statusCode, 202);
    const startBody = started.json() as { scan: { scanId: string; status: string } };
    assert.equal(startBody.scan.status, "QUEUED");
    const scanId = startBody.scan.scanId;

    const job = await waitForTerminalScan(context.scanner.persistence, scanId);
    assert.equal(job.status, "COMPLETED");

    const read = await context.app.inject({ method: "GET", url: `/api/scanner/scans/${scanId}` });
    assert.equal(read.statusCode, 200);
    const readBody = read.json() as { scan: { status: string; processCount: number } };
    assert.equal(readBody.scan.status, "COMPLETED");
    assert.equal(readBody.scan.processCount, 2);

    const listed = await context.app.inject({ method: "GET", url: "/api/scanner/scans?limit=10" });
    assert.equal(listed.statusCode, 200);
    const listBody = listed.json() as { scans: unknown[]; count: number };
    assert.equal(listBody.count, 1);
  } finally {
    await context.cleanup();
  }
});

test("the scan request body is strictly empty: commands and paths are rejected", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    for (const payload of [
      { command: "whoami" },
      { executablePath: "C:\\Windows\\System32\\cmd.exe" },
      { platform: "bluestacks_5" },
    ]) {
      const response = await context.app.inject({
        method: "POST",
        url: "/api/scanner/scans",
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal((response.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");
    }
  } finally {
    await context.cleanup();
  }
});

test("scanner query params are validated instead of silently defaulted", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const badLimit = await context.app.inject({
      method: "GET",
      url: "/api/scanner/scans?limit=0",
    });
    assert.equal(badLimit.statusCode, 400);
  } finally {
    await context.cleanup();
  }
});

test("unknown scans return SCAN_NOT_FOUND on every scanner route", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    for (const url of [
      "/api/scanner/scans/scan-missing",
      "/api/scanner/scans/scan-missing/evidence",
      "/api/scanner/scans/scan-missing/findings",
      "/api/scanner/scans/scan-missing/events",
      "/api/scanner/scans/scan-missing/report",
    ]) {
      const response = await context.app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404);
      assert.equal((response.json() as { error: { code: string } }).error.code, "SCAN_NOT_FOUND");
    }
    const cancel = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans/scan-missing/cancel",
    });
    assert.equal(cancel.statusCode, 404);
  } finally {
    await context.cleanup();
  }
});

test("evidence and findings endpoints expose persisted scan data with pagination", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const started = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    const scanId = (started.json() as { scan: { scanId: string } }).scan.scanId;
    await waitForTerminalScan(context.scanner.persistence, scanId);

    const evidence = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/evidence?limit=1&offset=0`,
    });
    assert.equal(evidence.statusCode, 200);
    const evidenceBody = evidence.json() as {
      evidence: Array<{ evidenceId: string }>;
      count: number;
      limit: number;
      offset: number;
    };
    assert.equal(evidenceBody.count, 1);
    assert.equal(evidenceBody.limit, 1);
    assert.equal(evidenceBody.evidence[0]?.evidenceId, `${scanId}:proc:100`);

    const findings = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/findings`,
    });
    assert.equal(findings.statusCode, 200);
    assert.equal((findings.json() as { count: number }).count, 0);
  } finally {
    await context.cleanup();
  }
});

test("the events endpoint serves the console feed with an after cursor", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const started = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    const scanId = (started.json() as { scan: { scanId: string } }).scan.scanId;
    await waitForTerminalScan(context.scanner.persistence, scanId);

    const full = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/events`,
    });
    assert.equal(full.statusCode, 200);
    const fullBody = full.json() as {
      events: Array<{ seq: number; kind: string; text: string; createdAt: string }>;
      count: number;
      nextAfter: number | null;
    };
    assert.ok(fullBody.count > 0);
    assert.equal(fullBody.count, fullBody.events.length);
    assert.equal(fullBody.nextAfter, fullBody.events[fullBody.events.length - 1]!.seq);
    assert.equal(fullBody.events[0]!.kind, "command");

    const tail = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/events?after=${fullBody.nextAfter}&limit=10`,
    });
    assert.equal(tail.statusCode, 200);
    const tailBody = tail.json() as { events: unknown[]; count: number; nextAfter: number };
    assert.equal(tailBody.count, 0);
    assert.equal(tailBody.nextAfter, fullBody.nextAfter);

    const invalid = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/events?limit=501`,
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal((invalid.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR");
  } finally {
    await context.cleanup();
  }
});

test("the report endpoint returns the heuristic risk score and honest statistics", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const started = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    const scanId = (started.json() as { scan: { scanId: string } }).scan.scanId;
    await waitForTerminalScan(context.scanner.persistence, scanId);

    const response = await context.app.inject({
      method: "GET",
      url: `/api/scanner/scans/${scanId}/report`,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      report: {
        generatedAt: string;
        job: { scanId: string; status: string };
        findings: unknown[];
        risk: { basis: string; score: number; band: string };
        stats: {
          evidenceRecords: number;
          evidenceTruncated: boolean;
          signatures: Record<string, number>;
        };
      };
    };
    assert.equal(body.report.job.scanId, scanId);
    assert.equal(body.report.job.status, "COMPLETED");
    assert.equal(body.report.risk.basis, "heuristic");
    assert.equal(body.report.risk.score, 0);
    assert.equal(body.report.risk.band, "LOW");
    assert.equal(body.report.stats.evidenceRecords, 2);
    assert.equal(body.report.stats.evidenceTruncated, false);
    assert.equal(body.report.stats.signatures.notChecked, 2);
  } finally {
    await context.cleanup();
  }
});

test("capabilities honestly describe the registered (mocked) collector", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const response = await context.app.inject({ method: "GET", url: "/api/scanner/capabilities" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      capabilities: {
        collectorProvenance: string | null;
        features: { processInventory: { available: boolean } };
        limitations: string[];
      };
    };
    assert.equal(body.capabilities.collectorProvenance, "mocked");
    assert.equal(body.capabilities.features.processInventory.available, true);
    assert.equal(
      body.capabilities.limitations.some((item) => item.includes("simulated")),
      true,
    );
  } finally {
    await context.cleanup();
  }
});

test("cancelling a finished scan is rejected with INVALID_TRANSITION", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const started = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    const scanId = (started.json() as { scan: { scanId: string } }).scan.scanId;
    await waitForTerminalScan(context.scanner.persistence, scanId);
    const cancel = await context.app.inject({
      method: "POST",
      url: `/api/scanner/scans/${scanId}/cancel`,
    });
    assert.equal(cancel.statusCode, 409);
    assert.equal((cancel.json() as { error: { code: string } }).error.code, "INVALID_TRANSITION");
  } finally {
    await context.cleanup();
  }
});

test("the scan queue capacity is enforced at the API level", async () => {
  let releaseFn: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  const slowCollector: ProcessInventoryCollector = {
    provenance: "mocked",
    scannerVersion: "mock-slow-0.0.0",
    async collectProcesses(context) {
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          context.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("The scan was cancelled.");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
      ]);
      return {
        records: [],
        attempted: 0,
        completed: 0,
        complete: true,
        warnings: [],
        limitations: [],
      };
    },
  };
  const context = await createTestApp({
    env: { DYNIX_MAX_CONCURRENT_SCANS: "1", DYNIX_MAX_QUEUED_SCANS: "0" },
    scanner: { processCollector: slowCollector, executableCollector: null },
  });
  try {
    const first = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    assert.equal(first.statusCode, 202);

    const busy = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      payload: {},
    });
    assert.equal(busy.statusCode, 429);
    assert.equal((busy.json() as { error: { code: string } }).error.code, "SCAN_QUEUE_FULL");

    releaseFn?.();
    await waitForTerminalScan(
      context.scanner.persistence,
      (first.json() as { scan: { scanId: string } }).scan.scanId,
    );
  } finally {
    await context.cleanup();
  }
});

test("a backend restart fails scans that were still running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dynix-trace-restart-"));
  const env = readEnv({}, dir);
  const dbPath = join(dir, "restart.sqlite");
  const collector = MOCK_COLLECTOR();

  const first = await buildApp({
    env,
    dbPath,
    scanner: { processCollector: collector, executableCollector: null },
  });
  await first.app.ready();
  await first.scanner.persistence.createJob({
    scanId: "scan-left-running",
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
  });
  await first.scanner.persistence.updateJob("scan-left-running", {
    status: "RUNNING",
    startedAt: "2026-01-01T00:00:01.000Z",
  });
  await first.app.close();

  const second = await buildApp({
    env,
    dbPath,
    scanner: { processCollector: collector, executableCollector: null },
  });
  await second.app.ready();
  try {
    const job = await second.scanner.persistence.getJob("scan-left-running");
    assert.equal(job?.status, "FAILED");
    assert.equal(job?.error?.code, "SCAN_INTERRUPTED");
  } finally {
    await second.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a POST with an unsupported content type gets a 415, not a masked 500", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/scanner/scans",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "a=1",
    });
    assert.equal(response.statusCode, 415);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "FST_ERR_CTP_INVALID_MEDIA_TYPE");
  } finally {
    await context.cleanup();
  }
});

test("scan endpoints are loopback-admin protected like the rest of the API", async () => {
  const context = await createTestApp({
    scanner: { processCollector: MOCK_COLLECTOR(), executableCollector: null },
  });
  try {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/scanner/scans",
      remoteAddress: "203.0.113.9",
    });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: { code: string } }).error.code, "LOCAL_ONLY");
  } finally {
    await context.cleanup();
  }
});
