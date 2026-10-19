import { join, resolve } from "node:path";

export type ServerEnv = {
  host: string;
  port: number;
  corsOrigins: string[];
  dataDir: string;
  dbPath: string;
  aiConfigPath: string;
  allowLocalAi: boolean;
  maxConcurrentScans: number;
  maxQueuedScans: number;
};

const DEFAULT_CORS_ORIGINS = ["http://localhost:5175", "http://127.0.0.1:5175"];

export function readEnv(
  source: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): ServerEnv {
  const host = source.HOST?.trim() || "127.0.0.1";

  const rawPort = source.PORT?.trim() || "3001";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${rawPort}". Expected an integer between 1 and 65535.`);
  }

  const configuredOrigins = (source.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const dataDir = resolve(baseDir, source.DATA_DIR?.trim() || ".data");

  const rawConcurrent = source.DYNIX_MAX_CONCURRENT_SCANS?.trim() || "1";
  const maxConcurrentScans = Number.parseInt(rawConcurrent, 10);
  if (!Number.isInteger(maxConcurrentScans) || maxConcurrentScans < 1 || maxConcurrentScans > 8) {
    throw new Error(
      `Invalid DYNIX_MAX_CONCURRENT_SCANS "${rawConcurrent}". Expected an integer between 1 and 8.`,
    );
  }

  const rawQueued = source.DYNIX_MAX_QUEUED_SCANS?.trim() || "5";
  const maxQueuedScans = Number.parseInt(rawQueued, 10);
  if (!Number.isInteger(maxQueuedScans) || maxQueuedScans < 0 || maxQueuedScans > 100) {
    throw new Error(
      `Invalid DYNIX_MAX_QUEUED_SCANS "${rawQueued}". Expected an integer between 0 and 100.`,
    );
  }

  return {
    host,
    port,
    corsOrigins: configuredOrigins.length > 0 ? configuredOrigins : [...DEFAULT_CORS_ORIGINS],
    dataDir,
    dbPath: join(dataDir, "dynix-trace.sqlite"),
    aiConfigPath: join(dataDir, "ai-config.json"),
    allowLocalAi: (source.DYNIX_ALLOW_LOCAL_AI ?? "false").trim().toLowerCase() === "true",
    maxConcurrentScans,
    maxQueuedScans,
  };
}
