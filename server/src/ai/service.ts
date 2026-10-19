import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import {
  AI_PROVIDER_IDS,
  getProviderAdapter,
  listProviderInfos,
  type AiConnectionResult,
  type AiProviderId,
  type AiRetryDeps,
  type AiRetryLogEvent,
} from "./adapters.ts";
import { assertSafeBaseUrl, assertSafeResolvedHost } from "./url-guard.ts";

export type AiConfigInput = {
  provider: AiProviderId;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  organizationId?: string | null;
};

export type AiConfigTestInput = {
  provider: AiProviderId;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  organizationId?: string | null;
};

export type AiConfigMetadata = {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  timeoutMs: number;
  maxRetries: number;
  organizationId: string | null;
  updatedAt: string;
};

type StoredAiConfig = {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  maxRetries: number;
  organizationId: string | null;
  updatedAt: string;
};

const DEFAULT_TIMEOUT_MS = 8000;

function isProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

function parseTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(60000, Math.max(1000, Math.round(value)));
}

function parseMaxRetries(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(5, Math.max(0, Math.round(value)));
}

function parseOrganizationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStoredConfig(raw: string): StoredAiConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (!isProviderId(record.provider)) return null;
  if (typeof record.baseUrl !== "string" || record.baseUrl.length === 0) return null;
  return {
    provider: record.provider,
    baseUrl: record.baseUrl,
    model: typeof record.model === "string" ? record.model : "",
    apiKey: typeof record.apiKey === "string" && record.apiKey.length > 0 ? record.apiKey : null,
    timeoutMs: parseTimeoutMs(record.timeoutMs),
    maxRetries: parseMaxRetries(record.maxRetries),
    organizationId: parseOrganizationId(record.organizationId),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  };
}

export function toMetadata(record: StoredAiConfig | null): AiConfigMetadata | null {
  if (!record) return null;
  return {
    provider: record.provider,
    baseUrl: record.baseUrl,
    model: record.model,
    hasApiKey: record.apiKey !== null,
    timeoutMs: record.timeoutMs,
    maxRetries: record.maxRetries,
    organizationId: record.organizationId,
    updatedAt: record.updatedAt,
  };
}

export class AiConfigService {
  private readonly env: ServerEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDeps: AiRetryDeps;
  private readonly inflightTests = new Map<string, Promise<AiConnectionResult>>();

  constructor(env: ServerEnv, fetchImpl?: typeof fetch, retryDeps?: AiRetryDeps) {
    this.env = env;
    this.fetchImpl = fetchImpl ?? fetch;
    this.retryDeps = retryDeps ?? {};
  }

  private allowsLocal(provider: AiProviderId): boolean {
    return getProviderAdapter(provider).allowsLocalNetwork || this.env.allowLocalAi;
  }

  private readStored(): StoredAiConfig | null {
    if (!existsSync(this.env.aiConfigPath)) return null;
    try {
      return parseStoredConfig(readFileSync(this.env.aiConfigPath, "utf8"));
    } catch {
      return null;
    }
  }

  private writeStored(record: StoredAiConfig): void {
    const file = this.env.aiConfigPath;
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(record, null, 2), "utf8");
    renameSync(temp, file);
  }

  getMetadata(): AiConfigMetadata | null {
    return toMetadata(this.readStored());
  }

  isConfigured(): boolean {
    return this.readStored() !== null;
  }

  listProviders() {
    return listProviderInfos();
  }

  save(input: AiConfigInput): AiConfigMetadata {
    const adapter = getProviderAdapter(input.provider);

    assertSafeBaseUrl(input.baseUrl, { allowLocalNetwork: this.allowsLocal(adapter.id) });

    const existing = this.readStored();
    let apiKey: string | null;
    if (input.apiKey === undefined) {
      apiKey = existing && existing.provider === input.provider ? existing.apiKey : null;
    } else {
      const trimmed = input.apiKey.trim();
      apiKey = trimmed.length > 0 ? trimmed : null;
    }

    const record: StoredAiConfig = {
      provider: input.provider,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model?.trim() ?? "",
      apiKey,
      timeoutMs: parseTimeoutMs(input.timeoutMs),
      maxRetries: parseMaxRetries(input.maxRetries),
      organizationId: parseOrganizationId(input.organizationId),
      updatedAt: new Date().toISOString(),
    };
    this.writeStored(record);

    const metadata = toMetadata(record);
    if (!metadata) {
      throw new AppError("INTERNAL_ERROR", 500, "Failed to persist AI configuration.");
    }
    return metadata;
  }

  reset(): void {
    rmSync(this.env.aiConfigPath, { force: true });
    rmSync(`${this.env.aiConfigPath}.tmp`, { force: true });
  }

  async test(
    input: AiConfigTestInput,
    log?: (event: AiRetryLogEvent) => void,
  ): Promise<AiConnectionResult> {
    const adapter = getProviderAdapter(input.provider);
    const guard: { allowLocalNetwork: boolean } = {
      allowLocalNetwork: this.allowsLocal(adapter.id),
    };

    const url = assertSafeBaseUrl(input.baseUrl, guard);
    await assertSafeResolvedHost(url, guard);

    const existing = this.readStored();
    const providedKey = input.apiKey?.trim();
    const apiKey =
      providedKey && providedKey.length > 0
        ? providedKey
        : existing && existing.provider === input.provider
          ? existing.apiKey
          : null;

    if (adapter.requiresApiKey && apiKey === null) {
      return {
        ok: false,
        provider: adapter.id,
        latencyMs: 0,
        error: {
          code: "MISSING_API_KEY",
          message: `Provider "${adapter.label}" requires an API key. Enter one, then test again.`,
        },
      };
    }

    const dedupeKey = [
      input.provider,
      input.baseUrl.trim(),
      input.model?.trim() ?? "",
      apiKey ?? "",
      input.timeoutMs ?? "",
      input.maxRetries ?? "",
      input.organizationId ?? "",
    ].join("\u0000");

    const inflight = this.inflightTests.get(dedupeKey);
    if (inflight) {
      return inflight;
    }

    const sameProvider = existing && existing.provider === input.provider;
    const promise = adapter
      .test(
        {
          provider: input.provider,
          baseUrl: input.baseUrl,
          model: input.model,
          apiKey,
          timeoutMs: input.timeoutMs ?? (sameProvider ? existing.timeoutMs : undefined),
          maxRetries: input.maxRetries ?? (sameProvider ? existing.maxRetries : undefined),
          organizationId:
            input.organizationId !== undefined
              ? input.organizationId
              : sameProvider
                ? existing.organizationId
                : null,
        },
        this.fetchImpl,
        {
          ...this.retryDeps,
          log: log ?? this.retryDeps.log,
        },
      )
      .finally(() => {
        if (this.inflightTests.get(dedupeKey) === promise) {
          this.inflightTests.delete(dedupeKey);
        }
      });

    this.inflightTests.set(dedupeKey, promise);
    return promise;
  }
}

export function createAiConfigService(
  env: ServerEnv,
  fetchImpl?: typeof fetch,
  retryDeps?: AiRetryDeps,
): AiConfigService {
  return new AiConfigService(env, fetchImpl, retryDeps);
}
