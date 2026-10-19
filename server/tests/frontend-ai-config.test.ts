import assert from "node:assert/strict";
import { test } from "node:test";
import { AiApiError, createAiConfigClient } from "../../src/lib/ai-config.ts";

test("an unreachable backend produces a clear BACKEND_UNREACHABLE error", async () => {
  const client = createAiConfigClient("http://127.0.0.1:3001", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    () => client.getConfig(),
    (error: unknown) =>
      error instanceof AiApiError &&
      error.code === "BACKEND_UNREACHABLE" &&
      /not reachable/i.test(error.message),
  );
});

test("server error payloads surface their code and message", async () => {
  const client = createAiConfigClient("http://127.0.0.1:3001", async () =>
    new Response(
      JSON.stringify({
        error: { code: "BLOCKED_ADDRESS", message: "Host points to a local address." },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    ),
  );
  await assert.rejects(
    () => client.saveConfig({ provider: "openai", baseUrl: "http://127.0.0.1:8080" }),
    (error: unknown) =>
      error instanceof AiApiError &&
      error.code === "BLOCKED_ADDRESS" &&
      error.status === 400 &&
      error.message === "Host points to a local address.",
  );
});

test("non-JSON error responses fall back to an HTTP status code", async () => {
  const client = createAiConfigClient("http://127.0.0.1:3001", async () =>
    new Response("<html>bad gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    }),
  );
  await assert.rejects(
    () => client.testConnection({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" }),
    (error: unknown) =>
      error instanceof AiApiError && error.code === "HTTP_502" && error.status === 502,
  );
});

test("successful responses are unwrapped into typed payloads", async () => {
  const client = createAiConfigClient("http://127.0.0.1:3001", async () =>
    new Response(
      JSON.stringify({
        config: {
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "llama3",
          hasApiKey: false,
          updatedAt: "2026-10-18T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  const config = await client.getConfig();
  assert.equal(config?.provider, "ollama");
  assert.equal(config?.hasApiKey, false);
});

test("connection test failures are returned as data, not thrown", async () => {
  const client = createAiConfigClient("http://127.0.0.1:3001", async () =>
    new Response(
      JSON.stringify({
        result: {
          ok: false,
          provider: "ollama",
          latencyMs: 12,
          error: { code: "UNREACHABLE", message: "Provider is not reachable." },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  const result = await client.testConnection({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "UNREACHABLE");
});
