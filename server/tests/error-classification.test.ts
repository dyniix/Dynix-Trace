import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp } from "./helpers.ts";

const BASE_INPUT = {
  provider: "custom" as const,
  baseUrl: "http://127.0.0.1:9/audit",
  model: "audit-model",
  apiKey: "test-key",
};

const ALLOW_LOCAL = { DYNIX_ALLOW_LOCAL_AI: "true" };

type ResultBody = {
  ok: false;
  error: { code: string; message: string };
  attempts?: number;
  status?: string;
  retryAfterSeconds?: number;
};

async function classifyWith(fetchImpl: typeof fetch): Promise<ResultBody> {
  const ctx = await createTestApp({ env: ALLOW_LOCAL, fetchImpl });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: BASE_INPUT,
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.ok, false);
    return result as ResultBody;
  } finally {
    await ctx.cleanup();
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a 404 that names the model classifies as MODEL_NOT_FOUND, not a base URL problem", async () => {
  const result = await classifyWith(
    (async () =>
      jsonResponse(404, {
        error: {
          message: "The model `audit-model` does not exist or you do not have access to it.",
          type: "invalid_request_error",
          code: "model_not_found",
        },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "MODEL_NOT_FOUND");
  assert.match(result.error.message, /audit-model/);
  assert.doesNotMatch(result.error.message, /base url/i);
  assert.doesNotMatch(result.error.message, /test-key/);
});

test("a 400 model error classifies as MODEL_NOT_FOUND", async () => {
  const result = await classifyWith(
    (async () =>
      jsonResponse(400, {
        error: { message: "Invalid model: audit-model does not exist", type: "invalid_request_error" },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "MODEL_NOT_FOUND");
  assert.match(result.error.message, /audit-model/);
});

test("an Ollama-style string error body for a missing model classifies as MODEL_NOT_FOUND", async () => {
  const result = await classifyWith(
    (async () => jsonResponse(404, { error: "model 'audit-model' not found, try pulling it first" })) as typeof fetch,
  );
  assert.equal(result.error.code, "MODEL_NOT_FOUND");
});

test("an Anthropic-style not_found_error for a model classifies as MODEL_NOT_FOUND", async () => {
  const result = await classifyWith(
    (async () =>
      jsonResponse(404, {
        type: "error",
        error: { type: "not_found_error", message: "model: audit-model" },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "MODEL_NOT_FOUND");
});

test("a 404 whose body points at the URL classifies as ENDPOINT_NOT_FOUND with the base URL hint", async () => {
  const result = await classifyWith(
    (async () =>
      jsonResponse(404, {
        error: { message: "Unknown request URL: POST /v1/chat/completions. Please check the URL." },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "ENDPOINT_NOT_FOUND");
  assert.match(result.error.message, /base url/i);
});

test("an ambiguous 404 without a usable body hedges between base URL and model", async () => {
  const result = await classifyWith((async () => new Response("", { status: 404 })) as typeof fetch);
  assert.equal(result.error.code, "ENDPOINT_NOT_FOUND");
  assert.match(result.error.message, /base url/i);
  assert.match(result.error.message, /model id/i);
});

test("a 403 that names permissions classifies as INSUFFICIENT_PERMISSIONS", async () => {
  const result = await classifyWith(
    (async () =>
      jsonResponse(403, {
        error: { message: "You do not have permission to access this resource.", type: "permission_error" },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "INSUFFICIENT_PERMISSIONS");
  assert.match(result.error.message, /permission/i);
});

test("an ambiguous 403 stays INVALID_CREDENTIALS for compatibility", async () => {
  const result = await classifyWith((async () => new Response("", { status: 403 })) as typeof fetch);
  assert.equal(result.error.code, "INVALID_CREDENTIALS");
});

test("a 401 stays INVALID_CREDENTIALS", async () => {
  const result = await classifyWith(
    (async () => jsonResponse(401, { error: { message: "Invalid API key provided" } })) as typeof fetch,
  );
  assert.equal(result.error.code, "INVALID_CREDENTIALS");
  assert.equal(result.attempts, 1);
});

test("a 429 stays RATE_LIMITED and keeps the retry-later status", async () => {
  const result = await classifyWith(
    (async () =>
      new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "75" },
      })) as typeof fetch,
  );
  assert.equal(result.error.code, "RATE_LIMITED");
  assert.equal(result.status, "RATE_LIMIT_WAIT");
  assert.equal(result.retryAfterSeconds, 75);
});
