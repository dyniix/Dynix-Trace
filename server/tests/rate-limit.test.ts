import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AiRetryDeps, AiRetryLogEvent } from "../src/ai/adapters.ts";
import { createAiConfigService } from "../src/ai/service.ts";
import { openDatabase } from "../src/db.ts";
import { readEnv } from "../src/env.ts";
import {
  getScanJob,
  insertAiAnalysis,
  insertFinding,
  insertScanJob,
  listAiAnalysesByJob,
  listFindingsByJob,
} from "../src/repositories.ts";
import { createTestApp } from "./helpers.ts";

const BASE_INPUT = {
  provider: "custom",
  baseUrl: "http://127.0.0.1:9/audit",
  model: "audit-model",
} as const;

function fakeClock(): { deps: Pick<AiRetryDeps, "sleep" | "now">; waits: number[] } {
  let current = 1_000_000;
  const waits: number[] = [];
  return {
    waits,
    deps: {
      sleep: async (ms: number) => {
        waits.push(ms);
        current += ms;
      },
      now: () => current,
    },
  };
}

function okReply(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function rateLimited(options: {
  retryAfter?: string;
  resetTokens?: string;
  message?: string;
}): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.retryAfter !== undefined) headers["retry-after"] = options.retryAfter;
  if (options.resetTokens !== undefined) headers["x-ratelimit-reset-tokens"] = options.resetTokens;
  return new Response(
    JSON.stringify({ error: { message: options.message ?? "Rate limit reached for requests." } }),
    { status: 429, headers },
  );
}

test("HTTP 429 with Retry-After of 10 seconds waits, retries, and succeeds", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return calls === 1 ? rateLimited({ retryAfter: "10" }) : okReply();
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-1", maxRetries: 1 },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.totalWaitMs, 10000);
    assert.deepEqual(clock.waits, [10000]);
    assert.equal(calls, 2);
  } finally {
    await ctx.cleanup();
  }
});

test("HTTP 429 beyond the 60-second window returns retry-later without waiting", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return rateLimited({ retryAfter: "75" });
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-2", maxRetries: 2 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "RATE_LIMITED");
    assert.equal(result.status, "RATE_LIMIT_WAIT");
    assert.equal(result.retryAfterSeconds, 75);
    assert.equal(result.attempts, 1);
    assert.equal(result.totalWaitMs, 0);
    assert.deepEqual(clock.waits, []);
    assert.equal(calls, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("HTTP 429 without retry information uses conservative bounded backoff", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return calls === 1 ? rateLimited({}) : okReply();
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-3", maxRetries: 1 },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(result.totalWaitMs, 2000);
    assert.deepEqual(clock.waits, [2000]);
    assert.equal(calls, 2);
  } finally {
    await ctx.cleanup();
  }
});

test("daily quota exhaustion is reported as QUOTA_EXHAUSTED without waiting", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return rateLimited({
      retryAfter: "30",
      message: "Rate limit reached for tokens per day (TPD): limit 500000, used 499999.",
    });
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-4", maxRetries: 3 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "QUOTA_EXHAUSTED");
    assert.equal(result.status, "AI_TEMPORARILY_UNAVAILABLE");
    assert.equal(result.rateLimitKind, "daily_quota");
    assert.equal(result.attempts, 1);
    assert.deepEqual(clock.waits, []);
    assert.equal(calls, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("reset-token header is used when Retry-After is absent", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return calls === 1 ? rateLimited({ resetTokens: "3.5s" }) : okReply();
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-5", maxRetries: 1 },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(result.totalWaitMs, 3500);
    assert.deepEqual(clock.waits, [3500]);
  } finally {
    await ctx.cleanup();
  }
});

test("repeated 429 responses stop after the configured retry limit", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return rateLimited({ retryAfter: "5" });
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-6", maxRetries: 3 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "RATE_LIMITED");
    assert.equal(result.attempts, 4);
    assert.equal(result.totalWaitMs, 15000);
    assert.deepEqual(clock.waits, [5000, 5000, 5000]);
    assert.equal(calls, 4);
  } finally {
    await ctx.cleanup();
  }
});

test("the 60-second automatic waiting budget is never exceeded", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return rateLimited({ retryAfter: "40" });
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
    retryDeps: clock.deps,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-7", maxRetries: 3 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "RATE_LIMITED");
    assert.equal(result.attempts, 2);
    assert.equal(result.totalWaitMs, 40000);
    assert.deepEqual(clock.waits, [40000]);
    assert.equal(calls, 2);
  } finally {
    await ctx.cleanup();
  }
});

test("authentication failures are not retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { ...BASE_INPUT, apiKey: "audit-key-8", maxRetries: 3 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_CREDENTIALS");
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("an AI failure does not disturb completed scan findings", () => {
  const db = openDatabase(":memory:");
  try {
    insertScanJob(db, {
      id: "scan-rl-1",
      platform: "bluestacks_5",
      gameTarget: "free_fire",
      status: "completed",
      completedAt: "2026-10-18T10:00:00.000Z",
    });
    insertFinding(db, {
      id: "finding-rl-1",
      scanJobId: "scan-rl-1",
      category: "file_integrity",
      severity: "low",
      status: "MODIFIED",
      title: "Config file differs",
      description: "Fixture finding.",
    });
    insertAiAnalysis(db, {
      id: "analysis-rl-1",
      scanJobId: "scan-rl-1",
      provider: "groq",
      model: "qwen/qwen3.8-27b",
      status: "pending",
      error: { code: "RATE_LIMITED", message: "Waiting for the provider rate limit." },
    });

    const job = getScanJob(db, "scan-rl-1");
    assert.equal(job?.status, "completed");
    assert.equal(job?.error, null);
    assert.equal(listFindingsByJob(db, "scan-rl-1").length, 1);
    const analyses = listAiAnalysesByJob(db, "scan-rl-1");
    assert.equal(analyses.length, 1);
    assert.equal(analyses[0].status, "pending");
    assert.equal(analyses[0].error?.code, "RATE_LIMITED");
  } finally {
    db.close();
  }
});

test("concurrent duplicate submissions share a single provider request", async () => {
  let calls = 0;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const fetchImpl = (async () => {
    calls += 1;
    await gate;
    return okReply();
  }) as typeof fetch;
  const ctx = await createTestApp({
    env: { DYNIX_ALLOW_LOCAL_AI: "true" },
    fetchImpl,
  });
  try {
    const payload = { ...BASE_INPUT, apiKey: "audit-key-9", maxRetries: 0 };
    const first = ctx.app.inject({ method: "POST", url: "/api/ai/test", payload });
    const second = ctx.app.inject({ method: "POST", url: "/api/ai/test", payload });
    for (let i = 0; i < 50 && calls === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(calls, 1);
    releaseGate();
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(r1.json().result.ok, true);
    assert.deepEqual(r1.json().result, r2.json().result);
  } finally {
    await ctx.cleanup();
  }
});

test("API keys never appear in retry logs or responses", async () => {
  const key = "audit-secret-key-never-log";
  const clock = fakeClock();
  const events: AiRetryLogEvent[] = [];
  const fetchImpl = (async () => rateLimited({ retryAfter: "5" })) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "dynix-rl-"));
  const env = readEnv({ DYNIX_ALLOW_LOCAL_AI: "true", DATA_DIR: dir }, dir);
  try {
    const service = createAiConfigService(env, fetchImpl, {
      ...clock.deps,
      log: (event) => {
        events.push(event);
      },
    });
    const result = await service.test({
      ...BASE_INPUT,
      apiKey: key,
      maxRetries: 1,
    });
    assert.ok(events.length > 0);
    assert.equal(JSON.stringify(events).includes(key), false);
    assert.equal(JSON.stringify(result).includes(key), false);

    const ctx = await createTestApp({
      env: { DYNIX_ALLOW_LOCAL_AI: "true" },
      fetchImpl,
      retryDeps: clock.deps,
    });
    try {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/ai/config/test",
        payload: { ...BASE_INPUT, apiKey: key, maxRetries: 1 },
      });
      assert.equal(response.body.includes(key), false);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
