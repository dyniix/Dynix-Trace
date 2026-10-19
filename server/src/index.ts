import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { readEnv } from "./env.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env file present - environment variables or defaults apply.
}

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const env = readEnv(process.env, serverRoot);

const { app } = await buildApp({ env, logger: true });

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`AI configuration storage: ${env.aiConfigPath}`);
  app.log.info(`Database: ${env.dbPath}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down.`);
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
