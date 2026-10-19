import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp } from "./helpers.ts";

const SECRET = "sk-secret-TEST-123";

async function saveOpenAiWithKey(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  return ctx.app.inject({
    method: "PUT",
    url: "/api/ai/config",
    payload: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: SECRET,
    },
  });
}

test("saving a config stores the key but never returns it", async () => {
  const ctx = await createTestApp();
  try {
    const put = await saveOpenAiWithKey(ctx);
    assert.equal(put.statusCode, 200);
    assert.equal(put.body.includes(SECRET), false, "response body must not contain the API key");

    const body = put.json();
    assert.equal(body.config.provider, "openai");
    assert.equal(body.config.hasApiKey, true);
    assert.equal("apiKey" in body.config, false);

    const get = await ctx.app.inject({ method: "GET", url: "/api/ai/config" });
    assert.equal(get.statusCode, 200);
    assert.equal(get.body.includes(SECRET), false, "GET response must not contain the API key");
    const getBody = get.json();
    assert.equal(getBody.config.hasApiKey, true);
    assert.equal("apiKey" in getBody.config, false);
  } finally {
    await ctx.cleanup();
  }
});

test("saving without an API key keeps the stored key for the same provider", async () => {
  const ctx = await createTestApp();
  try {
    await saveOpenAiWithKey(ctx);
    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
    });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().config.hasApiKey, true);
  } finally {
    await ctx.cleanup();
  }
});

test("switching providers without a new key clears the stored key", async () => {
  const ctx = await createTestApp();
  try {
    await saveOpenAiWithKey(ctx);
    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().config.hasApiKey, false);
  } finally {
    await ctx.cleanup();
  }
});

test("an explicitly empty API key clears the stored key", async () => {
  const ctx = await createTestApp();
  try {
    await saveOpenAiWithKey(ctx);
    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "" },
    });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().config.hasApiKey, false);
  } finally {
    await ctx.cleanup();
  }
});

test("DELETE removes the configuration, including the stored key", async () => {
  const ctx = await createTestApp();
  try {
    await saveOpenAiWithKey(ctx);
    const del = await ctx.app.inject({ method: "DELETE", url: "/api/ai/config" });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().config, null);

    const get = await ctx.app.inject({ method: "GET", url: "/api/ai/config" });
    assert.equal(get.json().config, null);

    const health = await ctx.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.json().ai.configured, false);
  } finally {
    await ctx.cleanup();
  }
});

test("invalid provider ids are rejected", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "gemini", baseUrl: "https://example.com" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  } finally {
    await ctx.cleanup();
  }
});

test("malformed and non-http base URLs are rejected", async () => {
  const ctx = await createTestApp();
  try {
    for (const baseUrl of ["not-a-url", "ftp://api.openai.com", "file:///etc/passwd"]) {
      const response = await ctx.app.inject({
        method: "PUT",
        url: "/api/ai/config",
        payload: { provider: "openai", baseUrl },
      });
      assert.equal(response.statusCode, 400, `expected 400 for ${baseUrl}`);
      assert.equal(response.json().error.code, "INVALID_BASE_URL", `expected INVALID_BASE_URL for ${baseUrl}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("loopback base URLs are blocked for cloud providers", async () => {
  const ctx = await createTestApp();
  try {
    for (const baseUrl of ["http://127.0.0.1:8080/v1", "http://localhost:8080/v1", "http://[::1]:8080"]) {
      const response = await ctx.app.inject({
        method: "PUT",
        url: "/api/ai/config",
        payload: { provider: "openai", baseUrl },
      });
      assert.equal(response.statusCode, 400, `expected 400 for ${baseUrl}`);
      assert.equal(response.json().error.code, "BLOCKED_ADDRESS", `expected BLOCKED_ADDRESS for ${baseUrl}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("private network base URLs are blocked for cloud providers", async () => {
  const ctx = await createTestApp();
  try {
    for (const baseUrl of ["http://192.168.1.50:8080", "http://10.0.0.5:11434", "http://172.16.4.4:9000"]) {
      const response = await ctx.app.inject({
        method: "PUT",
        url: "/api/ai/config",
        payload: { provider: "openai", baseUrl },
      });
      assert.equal(response.statusCode, 400, `expected 400 for ${baseUrl}`);
      assert.equal(response.json().error.code, "BLOCKED_ADDRESS");
    }
  } finally {
    await ctx.cleanup();
  }
});

test("metadata and link-local addresses are always blocked, even with local AI enabled", async () => {
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const linkLocal = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "custom", baseUrl: "http://169.254.169.254/latest/meta-data" },
    });
    assert.equal(linkLocal.statusCode, 400);
    assert.equal(linkLocal.json().error.code, "BLOCKED_ADDRESS");

    const metadataHost = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "ollama", baseUrl: "http://metadata.google.internal" },
    });
    assert.equal(metadataHost.statusCode, 400);
    assert.equal(metadataHost.json().error.code, "BLOCKED_ADDRESS");
  } finally {
    await ctx.cleanup();
  }
});

test("the Ollama provider may target loopback", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "ollama", baseUrl: "http://127.0.0.1:11434" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().config.provider, "ollama");
  } finally {
    await ctx.cleanup();
  }
});

test("DYNIX_ALLOW_LOCAL_AI lets custom providers target local addresses", async () => {
  const blocked = await createTestApp();
  try {
    const response = await blocked.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "custom", baseUrl: "http://localhost:1234/v1" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "BLOCKED_ADDRESS");
  } finally {
    await blocked.cleanup();
  }

  const allowed = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await allowed.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "custom", baseUrl: "http://localhost:1234/v1" },
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await allowed.cleanup();
  }
});

test("advanced settings round-trip and persist across reads", async () => {
  const ctx = await createTestApp();
  try {
    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        timeoutMs: 15000,
        maxRetries: 3,
        organizationId: "org-test-42",
      },
    });
    assert.equal(put.statusCode, 200);
    const config = put.json().config;
    assert.equal(config.timeoutMs, 15000);
    assert.equal(config.maxRetries, 3);
    assert.equal(config.organizationId, "org-test-42");

    const get = await ctx.app.inject({ method: "GET", url: "/api/ai/config" });
    const stored = get.json().config;
    assert.equal(stored.timeoutMs, 15000);
    assert.equal(stored.maxRetries, 3);
    assert.equal(stored.organizationId, "org-test-42");
  } finally {
    await ctx.cleanup();
  }
});

test("advanced settings default when omitted and are clamped when partial", async () => {
  const ctx = await createTestApp();
  try {
    const plain = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
    });
    const config = plain.json().config;
    assert.equal(config.timeoutMs, 8000);
    assert.equal(config.maxRetries, 0);
    assert.equal(config.organizationId, null);
  } finally {
    await ctx.cleanup();
  }
});

test("out-of-range advanced settings are rejected with a clear validation error", async () => {
  const ctx = await createTestApp();
  try {
    const tooLarge = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", timeoutMs: 120000 },
    });
    assert.equal(tooLarge.statusCode, 400);
    assert.equal(tooLarge.json().error.code, "VALIDATION_ERROR");

    const negativeRetries = await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", maxRetries: -1 },
    });
    assert.equal(negativeRetries.statusCode, 400);
    assert.equal(negativeRetries.json().error.code, "VALIDATION_ERROR");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/ai/providers lists the supported providers without any secrets", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({ method: "GET", url: "/api/ai/providers" });
    assert.equal(response.statusCode, 200);
    const ids = response.json().providers.map((provider: { id: string }) => provider.id);
    assert.deepEqual(ids, ["openai", "anthropic", "openrouter", "groq", "ollama", "custom"]);
    assert.equal(ids.includes("gemini"), false);
    const groq = response.json().providers.find((provider: { id: string }) => provider.id === "groq");
    assert.equal(groq.defaultBaseUrl, "https://api.groq.com/openai/v1");
    assert.equal(groq.requiresApiKey, true);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/ai/test is an alias of the AI connection test", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/test",
      payload: { provider: "openai", baseUrl: "http://127.0.0.1:9999/v1", apiKey: "sk-test" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "BLOCKED_ADDRESS");
  } finally {
    await ctx.cleanup();
  }
});
