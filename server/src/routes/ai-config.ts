import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AI_PROVIDER_IDS, type AiRetryLogEvent } from "../ai/adapters.ts";
import type { AiConfigService } from "../ai/service.ts";
import { requireLocalAdmin } from "../auth/local-admin.ts";
import { AppError } from "../errors.ts";

const configInputSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  baseUrl: z.string().min(1).max(2048),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(512).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  organizationId: z.string().max(200).nullable().optional(),
});

const testInputSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  baseUrl: z.string().min(1).max(2048),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(512).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  organizationId: z.string().max(200).nullable().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "Invalid request body.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function makeRetryLogger(request: FastifyRequest) {
  return (event: AiRetryLogEvent): void => {
    request.log.info(event, "ai_retry");
  };
}

export function registerAiConfigRoutes(app: FastifyInstance, aiConfig: AiConfigService): void {
  app.get("/api/ai/providers", { preHandler: requireLocalAdmin }, async () => ({
    providers: aiConfig.listProviders(),
  }));

  app.get("/api/ai/config", { preHandler: requireLocalAdmin }, async () => ({
    config: aiConfig.getMetadata(),
  }));

  app.put("/api/ai/config", { preHandler: requireLocalAdmin }, async (request) => {
    const input = parseOrThrow(configInputSchema, request.body);
    return { config: aiConfig.save(input) };
  });

  app.delete("/api/ai/config", { preHandler: requireLocalAdmin }, async () => {
    aiConfig.reset();
    return { config: null };
  });

  app.post("/api/ai/config/test", { preHandler: requireLocalAdmin }, async (request) => {
    const input = parseOrThrow(testInputSchema, request.body);
    return { result: await aiConfig.test(input, makeRetryLogger(request)) };
  });

  app.post("/api/ai/test", { preHandler: requireLocalAdmin }, async (request) => {
    const input = parseOrThrow(testInputSchema, request.body);
    return { result: await aiConfig.test(input, makeRetryLogger(request)) };
  });
}
