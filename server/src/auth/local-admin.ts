import type { FastifyRequest } from "fastify";
import { AppError } from "../errors.ts";

const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export async function requireLocalAdmin(request: FastifyRequest): Promise<void> {
  if (LOCAL_ADDRESSES.has(request.ip)) return;
  throw new AppError(
    "LOCAL_ONLY",
    403,
    "This endpoint is accessible from the local machine only.",
  );
}
