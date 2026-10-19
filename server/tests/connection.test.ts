import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";
import { createTestApp } from "./helpers.ts";

type MockProvider = {
  port: number;
  baseUrl: string;
  requests: {
    method: string;
    url: string;
    authorization?: string;
    xApiKey?: string;
    organization?: string;
  }[];
  close: () => Promise<void>;
};

function startMockProvider(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<MockProvider> {
  return new Promise((resolve) => {
    const requests: MockProvider["requests"] = [];
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        xApiKey: typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"] : undefined,
        organization:
          typeof request.headers["openai-organization"] === "string"
            ? request.headers["openai-organization"]
            : undefined,
      });
      handler(request, response);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
  });
}

test("connection test rejects blocked addresses before any network call", async () => {
  let called = false;
  const ctx = await createTestApp({
    fetchImpl: (() => {
      called = true;
      throw new Error("fetch must not be called for blocked addresses");
    }) as typeof fetch,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "openai", baseUrl: "http://127.0.0.1:9999/v1", apiKey: "sk-test" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "BLOCKED_ADDRESS");
    assert.equal(called, false);
  } finally {
    await ctx.cleanup();
  }
});

test("a cloud provider without any API key reports MISSING_API_KEY instead of a fake success", async () => {
  let called = false;
  const ctx = await createTestApp({
    fetchImpl: (() => {
      called = true;
      throw new Error("fetch must not be called without a key");
    }) as typeof fetch,
  });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "MISSING_API_KEY");
    assert.equal(called, false);
  } finally {
    await ctx.cleanup();
  }
});

test("a successful provider response reports ok with latency", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ models: [{ name: "llama3" }] }));
  });
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: mock.baseUrl },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(result.provider, "ollama");
    assert.equal(typeof result.latencyMs, "number");
    assert.match(result.detail, /Ollama/);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].url, "/api/tags");
    assert.equal(mock.requests[0].method, "GET");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("HTTP 401 maps to INVALID_CREDENTIALS", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid api key" }));
  });
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: mock.baseUrl },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_CREDENTIALS");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("HTTP 500 maps to PROVIDER_ERROR", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "boom" }));
  });
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: mock.baseUrl },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PROVIDER_ERROR");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("an unreachable host maps to UNREACHABLE", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200);
    response.end("{}");
  });
  const deadBaseUrl = mock.baseUrl;
  await mock.close();

  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: deadBaseUrl },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNREACHABLE");
  } finally {
    await ctx.cleanup();
  }
});

test("the provided API key is forwarded to the provider and never echoed back", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "model-1" }] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  const key = "sk-live-forwarding-test";
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "custom", baseUrl: mock.baseUrl, apiKey: key },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].authorization, `Bearer ${key}`);
    assert.equal(response.body.includes(key), false, "the key must not appear in the response");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("a live model reply reports success with the reply and latency", async () => {
  let capturedBody = "";
  const mock = await startMockProvider((request, response) => {
    request.on("data", (chunk) => {
      capturedBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "custom",
        baseUrl: mock.baseUrl,
        model: "test-model-1",
        apiKey: "sk-live-reply-test",
      },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(typeof result.latencyMs, "number");
    assert.match(result.detail, /test-model-1/);
    assert.match(result.detail, /OK/);

    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].method, "POST");
    assert.equal(mock.requests[0].url, "/chat/completions");
    const payload = JSON.parse(capturedBody);
    assert.equal(payload.model, "test-model-1");
    assert.equal(payload.stream, false);
    assert.equal(payload.messages[0].role, "user");
    assert.match(payload.messages[0].content, /connectivity/i);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("a 401 on the live message test maps to INVALID_CREDENTIALS", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid api key" }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "custom",
        baseUrl: mock.baseUrl,
        model: "test-model-1",
        apiKey: "sk-bad",
      },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_CREDENTIALS");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("an empty model reply is reported as INVALID_RESPONSE, not success", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "   " } }] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "custom", baseUrl: mock.baseUrl, model: "test-model-1" },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_RESPONSE");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("the Ollama live test uses /api/chat with the configured model", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: { content: "OK" } }));
  });
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: mock.baseUrl, model: "llama3" },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.match(result.detail, /llama3/);
    assert.equal(mock.requests[0].url, "/api/chat");
    assert.equal(mock.requests[0].method, "POST");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("the Anthropic live test uses /messages with the version header", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ content: [{ type: "text", text: "OK" }] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "anthropic",
        baseUrl: mock.baseUrl,
        model: "claude-test",
        apiKey: "sk-ant-live",
      },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.match(result.detail, /claude-test/);
    assert.equal(mock.requests[0].url, "/messages");
    assert.equal(mock.requests[0].xApiKey, "sk-ant-live");
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("the stored API key is used when the test request omits one", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  const key = "sk-stored-key-test";
  try {
    await ctx.app.inject({
      method: "PUT",
      url: "/api/ai/config",
      payload: { provider: "custom", baseUrl: mock.baseUrl, apiKey: key },
    });
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "custom", baseUrl: mock.baseUrl },
    });
    assert.equal(response.json().result.ok, true);
    assert.equal(mock.requests[0].authorization, `Bearer ${key}`);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("maxRetries retries transient network failures before reporting success", async () => {
  let attempts = 0;
  const mock = await startMockProvider((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "custom", baseUrl: mock.baseUrl, maxRetries: 1 },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(mock.requests.length, 2);
    assert.equal(attempts, 2);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("http error statuses are not retried", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid api key" }));
  });
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: { provider: "ollama", baseUrl: mock.baseUrl, maxRetries: 3 },
    });
    const result = response.json().result;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_CREDENTIALS");
    assert.equal(mock.requests.length, 1);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("organizationId is forwarded for OpenAI-compatible providers only", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const withOrg = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "custom",
        baseUrl: mock.baseUrl,
        organizationId: "org-abc-123",
      },
    });
    assert.equal(withOrg.json().result.ok, true);
    assert.equal(mock.requests[0].organization, "org-abc-123");

    const anthropicMock = await startMockProvider((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [] }));
    });
    const withoutOrg = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "anthropic",
        baseUrl: anthropicMock.baseUrl,
        apiKey: "sk-ant-test",
        organizationId: "org-abc-123",
      },
    });
    assert.equal(withoutOrg.json().result.ok, true);
    assert.equal(anthropicMock.requests[0].organization, undefined);
    await anthropicMock.close();
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});

test("the Groq provider is OpenAI-compatible and tests through /chat/completions", async () => {
  const mock = await startMockProvider((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" } }],
      }),
    );
  });
  const ctx = await createTestApp({ env: { DYNIX_ALLOW_LOCAL_AI: "true" } });
  try {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/ai/config/test",
      payload: {
        provider: "groq",
        baseUrl: mock.baseUrl,
        apiKey: "gsk-test",
        model: "qwen/qwen3.8-27b",
      },
    });
    const result = response.json().result;
    assert.equal(result.ok, true);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].method, "POST");
    assert.equal(mock.requests[0].url, "/chat/completions");
    assert.equal(mock.requests[0].authorization, "Bearer gsk-test");
    assert.match(result.detail, /qwen\/qwen3\.8-27b/);
  } finally {
    await ctx.cleanup();
    await mock.close();
  }
});
