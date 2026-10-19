import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { AiConfigService } from "../ai/service.ts";

export type HealthRouteDeps = {
  db: DatabaseSync;
  aiConfig: AiConfigService;
  version: string;
};

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get("/api/health", async () => {
    let dbOk = true;
    try {
      deps.db.prepare("SELECT 1 AS ok").get();
    } catch {
      dbOk = false;
    }

    return {
      status: "ok",
      service: "dynix-trace-server",
      version: deps.version,
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      db: { ok: dbOk },
      ai: { configured: deps.aiConfig.isConfigured() },
    };
  });
}
