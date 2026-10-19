import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { requireLocalAdmin } from "../auth/local-admin.ts";
import { AppError } from "../errors.ts";
import { getScanJob, listFindingsByJob, listScanJobs } from "../repositories.ts";

export function registerScanRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get("/api/scans", { preHandler: requireLocalAdmin }, async () => ({
    scans: listScanJobs(db),
  }));

  app.get<{ Params: { id: string } }>(
    "/api/scans/:id",
    { preHandler: requireLocalAdmin },
    async (request) => {
      const job = getScanJob(db, request.params.id);
      if (!job) {
        throw new AppError("NOT_FOUND", 404, `Scan job "${request.params.id}" does not exist.`);
      }
      return { scan: job, findings: listFindingsByJob(db, job.id) };
    },
  );
}
