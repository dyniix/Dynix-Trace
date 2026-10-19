import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AiRetryDeps } from "../src/ai/adapters.ts";
import { buildApp, type ScannerOverrides } from "../src/app.ts";
import { readEnv, type ServerEnv } from "../src/env.ts";
import { isTerminalScanStatus } from "../src/scanner/lifecycle.ts";
import type { ScanJob } from "../src/scanner/contracts.ts";
import type { ScanPersistencePort } from "../src/scanner/ports.ts";
import type { ScannerOrchestrator } from "../src/scanner/orchestrator.ts";

export type TestContext = {
  app: FastifyInstance;
  env: ServerEnv;
  scanner: {
    persistence: ScanPersistencePort;
    orchestrator: ScannerOrchestrator;
  };
  cleanup: () => Promise<void>;
};

export type TestAppOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  retryDeps?: AiRetryDeps;
  scanner?: ScannerOverrides;
  dbPath?: string;
};

export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), "dynix-trace-test-"));
  const env = readEnv(options.env ?? {}, dir);
  const built = await buildApp({
    env,
    dbPath: options.dbPath ?? ":memory:",
    fetchImpl: options.fetchImpl,
    retryDeps: options.retryDeps,
    scanner: options.scanner,
  });
  await built.app.ready();
  return {
    app: built.app,
    env,
    scanner: built.scanner,
    cleanup: async () => {
      await built.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitForTerminalScan(
  persistence: ScanPersistencePort,
  scanId: string,
  timeoutMs: number = 8000,
): Promise<ScanJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await persistence.getJob(scanId);
    if (job !== null && isTerminalScanStatus(job.status)) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Scan "${scanId}" did not reach a terminal state within ${timeoutMs} ms (last: ${job?.status ?? "missing"}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
