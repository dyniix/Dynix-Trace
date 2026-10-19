import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp } from "./helpers.ts";

test("GET /api/health reports service, database, and AI status", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "dynix-trace-server");
    assert.equal(typeof body.version, "string");
    assert.equal(body.db.ok, true);
    assert.equal(body.ai.configured, false);
  } finally {
    await ctx.cleanup();
  }
});

test("unknown routes return a structured NOT_FOUND error", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({ method: "GET", url: "/api/definitely-not-a-route" });
    assert.equal(response.statusCode, 404);
    const body = response.json();
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await ctx.cleanup();
  }
});

test("CORS allows the configured local frontend origin", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5175" },
    });
    assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5175");
  } finally {
    await ctx.cleanup();
  }
});

test("CORS does not allow unlisted origins", async () => {
  const ctx = await createTestApp();
  try {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://unlisted.example" },
    });
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  } finally {
    await ctx.cleanup();
  }
});
