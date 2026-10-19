import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireLocalAdmin } from "../auth/local-admin.ts";
import { AppError } from "../errors.ts";
import { scanRequestSchema } from "../scanner/contracts.ts";
import { buildScanReport } from "../scanner/analysis/report.ts";
import type { ScannerCapabilityProvider, ScanPersistencePort } from "../scanner/ports.ts";
import type { ScannerOrchestrator } from "../scanner/orchestrator.ts";

const MAX_LIMIT = 100;
const MAX_EVIDENCE_LIMIT = 200;
const MAX_EVENTS_LIMIT = 500;
const REPORT_EVIDENCE_LIMIT = 25000;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
});

const evidenceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_EVIDENCE_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});

const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS_LIMIT).default(200),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      `Invalid ${label}.`,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export type ScannerRouteDeps = {
  persistence: ScanPersistencePort;
  orchestrator: ScannerOrchestrator;
  capabilities: ScannerCapabilityProvider;
};

export function registerScannerRoutes(app: FastifyInstance, deps: ScannerRouteDeps): void {
  app.get("/api/scanner/capabilities", { preHandler: requireLocalAdmin }, async () => ({
    capabilities: await deps.capabilities.detectCapabilities(),
  }));

  app.post("/api/scanner/scans", { preHandler: requireLocalAdmin }, async (request, reply) => {
    // A strict empty body: any command, path or filter field is rejected here.
    parseOrThrow(scanRequestSchema, request.body ?? {}, "scan request body");
    const result = await deps.orchestrator.startScan({});
    reply.status(202);
    return { scan: { scanId: result.scanId, status: result.status } };
  });

  app.get("/api/scanner/scans", { preHandler: requireLocalAdmin }, async (request) => {
    const { limit } = parseOrThrow(listQuerySchema, request.query, "query");
    const scans = await deps.persistence.listJobs({ limit });
    return { scans, count: scans.length };
  });

  app.get<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const job = await deps.persistence.getJob(request.params.scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${request.params.scanId}" does not exist.`);
      }
      return { scan: job };
    },
  );

  app.post<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId/cancel",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const result = await deps.orchestrator.cancelScan(request.params.scanId);
      return { scan: { scanId: result.scanId, status: result.status } };
    },
  );

  app.get<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId/evidence",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const { limit, offset } = parseOrThrow(evidenceQuerySchema, request.query, "query");
      const job = await deps.persistence.getJob(request.params.scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${request.params.scanId}" does not exist.`);
      }
      const evidence = await deps.persistence.listProcessEvidence(request.params.scanId, {
        limit,
        offset,
      });
      return { evidence, count: evidence.length, limit, offset };
    },
  );

  app.get<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId/findings",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const job = await deps.persistence.getJob(request.params.scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${request.params.scanId}" does not exist.`);
      }
      const findings = await deps.persistence.listFindings(request.params.scanId);
      return { findings, count: findings.length };
    },
  );

  app.get<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId/events",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const { after, limit } = parseOrThrow(eventsQuerySchema, request.query, "query");
      const job = await deps.persistence.getJob(request.params.scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${request.params.scanId}" does not exist.`);
      }
      const events = await deps.persistence.listScanEvents(request.params.scanId, {
        afterSeq: after,
        limit,
      });
      const last = events.length > 0 ? events[events.length - 1] : undefined;
      return { events, count: events.length, nextAfter: last?.seq ?? after };
    },
  );

  app.get<{ Params: { scanId: string } }>(
    "/api/scanner/scans/:scanId/report",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const job = await deps.persistence.getJob(request.params.scanId);
      if (job === null) {
        throw new AppError("SCAN_NOT_FOUND", 404, `Scan "${request.params.scanId}" does not exist.`);
      }
      const evidence = await deps.persistence.listProcessEvidence(request.params.scanId, {
        limit: REPORT_EVIDENCE_LIMIT,
        offset: 0,
      });
      const evidenceTruncated =
        evidence.length === REPORT_EVIDENCE_LIMIT && job.processCount > REPORT_EVIDENCE_LIMIT;
      const findings = await deps.persistence.listFindings(request.params.scanId);
      const report = buildScanReport({
        job,
        findings,
        evidence,
        evidenceTruncated,
        generatedAt: new Date().toISOString(),
      });
      return { report };
    },
  );
}
