import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ServerEnv } from "./env.ts";
import { openDatabase } from "./db.ts";
import { AppError, errorBody } from "./errors.ts";
import type { AiRetryDeps } from "./ai/adapters.ts";
import { createAiConfigService, type AiConfigService } from "./ai/service.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerAiConfigRoutes } from "./routes/ai-config.ts";
import { registerScanRoutes } from "./routes/scans.ts";
import { registerScannerRoutes } from "./routes/scanner.ts";
import { createCapabilityProvider } from "./scanner/capabilities.ts";
import { createDefaultFindingRules } from "./scanner/analysis/rules.ts";
import type { ExecutableMetadataCollector, ProcessInventoryCollector, ScanPersistencePort } from "./scanner/ports.ts";
import { createScannerPersistence, ensureScannerSchema } from "./scanner/persistence.ts";
import { createScanOrchestrator, type ScannerOrchestrator } from "./scanner/orchestrator.ts";
import { createWindowsProcessCollector } from "./scanner/windows/collector.ts";
import { createExecutableMetadataCollector } from "./scanner/windows/executable.ts";

export const SERVER_VERSION = "0.1.0";

export type ScannerOverrides = {
  processCollector?: ProcessInventoryCollector | null;
  executableCollector?: ExecutableMetadataCollector | null;
};

export type BuildAppOptions = {
  env: ServerEnv;
  dbPath?: string;
  fetchImpl?: typeof fetch;
  retryDeps?: AiRetryDeps;
  logger?: boolean;
  scanner?: ScannerOverrides;
};

export type BuiltApp = {
  app: FastifyInstance;
  aiConfig: AiConfigService;
  scanner: {
    persistence: ScanPersistencePort;
    orchestrator: ScannerOrchestrator;
  };
};

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { env } = options;
  const app = Fastify({ logger: options.logger ?? false });
  const db = openDatabase(options.dbPath ?? env.dbPath);
  const aiConfig = createAiConfigService(env, options.fetchImpl, options.retryDeps);

  ensureScannerSchema(db);
  const scannerPersistence = createScannerPersistence(db);
  const onWindows = process.platform === "win32";
  const processCollector =
    options.scanner !== undefined && "processCollector" in options.scanner
      ? (options.scanner.processCollector ?? null)
      : onWindows
        ? createWindowsProcessCollector()
        : null;
  const executableCollector =
    options.scanner !== undefined && "executableCollector" in options.scanner
      ? (options.scanner.executableCollector ?? null)
      : onWindows
        ? createExecutableMetadataCollector()
        : null;
  const orchestrator = createScanOrchestrator({
    persistence: scannerPersistence,
    processCollector,
    executableCollector,
    rules: createDefaultFindingRules(),
    platform: process.platform,
    maxConcurrentScans: env.maxConcurrentScans,
    maxQueuedScans: env.maxQueuedScans,
  });
  await orchestrator.recoverInterruptedScans();
  const scannerCapabilities = createCapabilityProvider({ processCollector, executableCollector });

  await app.register(cors, {
    origin: env.corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply
        .status(error.status)
        .send(errorBody(error.code, error.message, error.details));
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send(
        errorBody(
          "VALIDATION_ERROR",
          "Invalid request.",
          error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
      return;
    }
    // Fastify's own 4xx errors (unsupported media type, payload too large,
    // malformed JSON, ...) keep their status instead of being masked as 500.
    const candidate = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (
      typeof candidate.statusCode === "number" &&
      candidate.statusCode >= 400 &&
      candidate.statusCode < 500
    ) {
      const code =
        typeof candidate.code === "string" && candidate.code.length > 0
          ? candidate.code
          : "REQUEST_ERROR";
      const message =
        typeof candidate.message === "string" &&
        candidate.message.length > 0 &&
        candidate.message.length <= 200
          ? candidate.message
          : "Invalid request.";
      reply.status(candidate.statusCode).send(errorBody(code, message));
      return;
    }
    request.log.error(error);
    reply.status(500).send(errorBody("INTERNAL_ERROR", "Unexpected server error."));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(errorBody("NOT_FOUND", `Route ${request.method} ${request.url} does not exist.`));
  });

  registerHealthRoutes(app, { db, aiConfig, version: SERVER_VERSION });
  registerAiConfigRoutes(app, aiConfig);
  registerScanRoutes(app, db);
  registerScannerRoutes(app, {
    persistence: scannerPersistence,
    orchestrator,
    capabilities: scannerCapabilities,
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  return {
    app,
    aiConfig,
    scanner: { persistence: scannerPersistence, orchestrator },
  };
}
