import type { AiOperationStatus } from "../domain.ts";
import {
  MAX_RATE_LIMIT_WAIT_MS,
  decideRateLimitAction,
  readRateLimitInfo,
  type RateLimitDecision,
  type RateLimitInfo,
  type RateLimitKind,
} from "./rate-limit.ts";

export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "openrouter",
  "groq",
  "ollama",
  "custom",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiConnectionInput = {
  provider: AiProviderId;
  baseUrl: string;
  model?: string;
  apiKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  organizationId?: string | null;
};

export type AiConnectionResult = {
  ok: boolean;
  provider: AiProviderId;
  latencyMs: number;
  detail?: string;
  error?: { code: string; message: string };
  status?: AiOperationStatus;
  retryAfterSeconds?: number;
  attempts?: number;
  totalWaitMs?: number;
  rateLimitKind?: RateLimitKind;
};

export type AiRetryLogEvent = {
  event: "ai_attempt" | "ai_rate_limit_wait" | "ai_retry_stop";
  provider: AiProviderId;
  attempt: number;
  maxAttempts: number;
  httpStatus?: number;
  waitMs?: number;
  totalWaitMs: number;
  outcome: string;
};

export type AiRetryDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (event: AiRetryLogEvent) => void;
};

export type AiProviderInfo = {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  allowsLocalNetwork: boolean;
};

export type AiProviderAdapter = AiProviderInfo & {
  test(
    config: AiConnectionInput,
    fetchImpl: typeof fetch,
    deps?: AiRetryDeps,
  ): Promise<AiConnectionResult>;
};

const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_RETRIES_LIMIT = 5;
export const MAX_TIMEOUT_MS = 60000;
export const MIN_TIMEOUT_MS = 1000;

function clampTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

function clampMaxRetries(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_RETRIES_LIMIT, Math.max(0, Math.round(value)));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

type ProbeOutcome =
  | { kind: "response"; status: number; latencyMs: number }
  | { kind: "rate-limit"; status: number; info: RateLimitInfo; latencyMs: number; stop?: RateLimitDecision }
  | { kind: "failure"; error: { code: string; message: string }; latencyMs: number };

async function probe(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: () => number,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 429) {
      let bodyText: string | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      return {
        kind: "rate-limit",
        status: 429,
        info: readRateLimitInfo(429, response.headers, bodyText, now()) ?? {
          kind: "unknown",
          retryAfterMs: null,
          source: "none",
        },
        latencyMs,
      };
    }
    return { kind: "response", status: response.status, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    const detail = isTimeout
      ? `Provider did not respond within ${timeoutMs / 1000} seconds.`
      : `Provider is not reachable: ${error instanceof Error ? error.message : "network request failed"}.`;
    return { kind: "failure", error: { code: "UNREACHABLE", message: detail }, latencyMs };
  }
}

async function probeWithRetries(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxRetries: number,
  provider: AiProviderId,
  deps: AiRetryDeps,
): Promise<{ outcome: ProbeOutcome; attempts: number; totalWaitMs: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxAttempts = maxRetries + 1;
  let attempts = 0;
  let waited = 0;
  let backoffIndex = 0;
  let outcome: ProbeOutcome = {
    kind: "failure",
    error: { code: "UNREACHABLE", message: "" },
    latencyMs: 0,
  };

  while (attempts < maxAttempts) {
    attempts += 1;
    outcome = await probe(url, headers, fetchImpl, timeoutMs, now);
    deps.log?.({
      event: "ai_attempt",
      provider,
      attempt: attempts,
      maxAttempts,
      httpStatus: outcome.kind === "response" ? outcome.status : outcome.kind === "rate-limit" ? 429 : undefined,
      totalWaitMs: waited,
      outcome:
        outcome.kind === "response"
          ? `http_${outcome.status}`
          : outcome.kind === "rate-limit"
            ? "rate_limited"
            : outcome.error.code.toLowerCase(),
    });
    if (outcome.kind === "rate-limit") {
      const decision = decideRateLimitAction({
        info: outcome.info,
        attemptsUsed: attempts,
        maxRetries,
        budgetLeftMs: MAX_RATE_LIMIT_WAIT_MS - waited,
        backoffIndex,
      });
      if (decision.action === "wait") {
        deps.log?.({
          event: "ai_rate_limit_wait",
          provider,
          attempt: attempts,
          maxAttempts,
          httpStatus: 429,
          waitMs: decision.waitMs,
          totalWaitMs: waited + decision.waitMs,
          outcome: "rate_limited_wait",
        });
        await sleep(decision.waitMs);
        waited += decision.waitMs;
        backoffIndex += 1;
        continue;
      }
      outcome.stop = decision;
      deps.log?.({
        event: "ai_retry_stop",
        provider,
        attempt: attempts,
        maxAttempts,
        httpStatus: 429,
        totalWaitMs: waited,
        outcome: decision.errorCode,
      });
      break;
    }
    if (outcome.kind !== "failure") break;
    if (attempts >= maxAttempts) break;
  }

  return { outcome, attempts, totalWaitMs: waited };
}

function classifyStatus(status: number): { code: string; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "INVALID_CREDENTIALS",
      message: `Provider rejected the credentials (HTTP ${status}). Check the API key.`,
    };
  }
  if (status === 404) {
    return {
      code: "ENDPOINT_NOT_FOUND",
      message: "Provider returned 404 for its model list endpoint. Check the base URL.",
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Provider rate-limited the connectivity test (HTTP 429).",
    };
  }
  if (status >= 500) {
    return {
      code: "PROVIDER_ERROR",
      message: `Provider reported a server error (HTTP ${status}).`,
    };
  }
  return { code: "PROVIDER_ERROR", message: `Provider responded with HTTP ${status}.` };
}

function rateLimitError(decision: RateLimitDecision, info: RateLimitInfo): {
  error: { code: string; message: string };
  status: AiOperationStatus;
  retryAfterSeconds?: number;
} {
  if (decision.action !== "stop") {
    throw new Error("rateLimitError expects a stop decision.");
  }
  const retryAfterSeconds =
    decision.errorCode === "RATE_LIMITED" && info.retryAfterMs !== null
      ? Math.ceil(info.retryAfterMs / 1000)
      : undefined;
  if (decision.errorCode === "QUOTA_EXHAUSTED") {
    return {
      error: {
        code: "QUOTA_EXHAUSTED",
        message:
          "Provider reports its quota for this model or account is exhausted (daily limit). Try again after the quota resets.",
      },
      status: decision.status,
      retryAfterSeconds,
    };
  }
  const message =
    retryAfterSeconds !== undefined
      ? `Provider rate-limited the request (HTTP 429). Retry after about ${retryAfterSeconds} seconds.`
      : "Provider rate-limited the request (HTTP 429). Wait briefly and try again.";
  return { error: { code: "RATE_LIMITED", message }, status: decision.status, retryAfterSeconds };
}

function resultFromProbe(
  provider: AiProviderId,
  outcome: ProbeOutcome,
  successDetail: string,
  meta: { attempts: number; totalWaitMs: number },
): AiConnectionResult {
  if (outcome.kind === "failure") {
    return {
      ok: false,
      provider,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  if (outcome.kind === "rate-limit") {
    const decision: RateLimitDecision = outcome.stop ?? {
      action: "stop",
      errorCode: "RATE_LIMITED",
      status: "RATE_LIMIT_WAIT",
    };
    const info = rateLimitError(decision, outcome.info);
    return {
      ok: false,
      provider,
      latencyMs: outcome.latencyMs,
      error: info.error,
      status: info.status,
      retryAfterSeconds: info.retryAfterSeconds,
      rateLimitKind: outcome.info.kind,
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return {
      ok: true,
      provider,
      latencyMs: outcome.latencyMs,
      detail: successDetail,
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  return {
    ok: false,
    provider,
    latencyMs: outcome.latencyMs,
    error: classifyStatus(outcome.status),
    attempts: meta.attempts,
    totalWaitMs: meta.totalWaitMs,
  };
}

const TEST_MESSAGE = "DYNIX TRACE connectivity check. Reply with the single word OK.";

type ReplyOutcome =
  | { kind: "reply"; latencyMs: number; reply: string }
  | { kind: "http-error"; latencyMs: number; status: number; bodyText: string | null }
  | { kind: "rate-limit"; latencyMs: number; status: number; info: RateLimitInfo; stop?: RateLimitDecision }
  | { kind: "failure"; error: { code: string; message: string }; latencyMs: number };

type ChatSpec = {
  url: string;
  payload: unknown;
  extractReply: (parsed: unknown) => string | null;
};

function extractOpenAiReply(parsed: unknown): string | null {
  const content = (parsed as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
    ?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof (part as { text?: unknown } | null)?.text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return null;
}

function extractAnthropicReply(parsed: unknown): string | null {
  const blocks = (parsed as { content?: unknown } | null)?.content;
  if (!Array.isArray(blocks)) return null;
  return blocks
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

function extractOllamaReply(parsed: unknown): string | null {
  const content = (parsed as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === "string" ? content : null;
}

function truncateReply(reply: string): string {
  const collapsed = reply.replace(/\s+/g, " ").trim();
  return collapsed.length > 40 ? `${collapsed.slice(0, 40)}…` : collapsed;
}

async function sendTestMessage(
  spec: ChatSpec,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: () => number,
): Promise<ReplyOutcome> {
  const started = Date.now();
  try {
    const response = await fetchImpl(spec.url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(spec.payload),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 429) {
      let bodyText: string | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      return {
        kind: "rate-limit",
        latencyMs,
        status: 429,
        info: readRateLimitInfo(429, response.headers, bodyText, now()) ?? {
          kind: "unknown",
          retryAfterMs: null,
          source: "none",
        },
      };
    }
    if (response.status < 200 || response.status >= 300) {
      let bodyText: string | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      return { kind: "http-error", latencyMs, status: response.status, bodyText };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        kind: "failure",
        latencyMs,
        error: { code: "INVALID_RESPONSE", message: "Provider reply was not valid JSON." },
      };
    }
    const reply = spec.extractReply(parsed);
    if (!reply || reply.trim().length === 0) {
      return {
        kind: "failure",
        latencyMs,
        error: {
          code: "INVALID_RESPONSE",
          message: "Provider replied without any message content.",
        },
      };
    }
    return { kind: "reply", latencyMs, reply };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    const detail = isTimeout
      ? `Provider did not respond within ${timeoutMs / 1000} seconds.`
      : `Provider is not reachable: ${error instanceof Error ? error.message : "network request failed"}.`;
    return { kind: "failure", latencyMs, error: { code: "UNREACHABLE", message: detail } };
  }
}

async function sendTestMessageWithRetries(
  spec: ChatSpec,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxRetries: number,
  provider: AiProviderId,
  deps: AiRetryDeps,
): Promise<{ outcome: ReplyOutcome; attempts: number; totalWaitMs: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxAttempts = maxRetries + 1;
  let attempts = 0;
  let waited = 0;
  let backoffIndex = 0;
  let outcome: ReplyOutcome = {
    kind: "failure",
    error: { code: "UNREACHABLE", message: "" },
    latencyMs: 0,
  };

  while (attempts < maxAttempts) {
    attempts += 1;
    outcome = await sendTestMessage(spec, headers, fetchImpl, timeoutMs, now);
    deps.log?.({
      event: "ai_attempt",
      provider,
      attempt: attempts,
      maxAttempts,
      httpStatus: outcome.kind === "reply" ? 200 : outcome.kind === "http-error" || outcome.kind === "rate-limit" ? outcome.status : undefined,
      totalWaitMs: waited,
      outcome:
        outcome.kind === "reply"
          ? "reply"
          : outcome.kind === "http-error"
            ? `http_${outcome.status}`
            : outcome.kind === "rate-limit"
              ? "rate_limited"
              : outcome.error.code.toLowerCase(),
    });
    if (outcome.kind === "rate-limit") {
      const decision = decideRateLimitAction({
        info: outcome.info,
        attemptsUsed: attempts,
        maxRetries,
        budgetLeftMs: MAX_RATE_LIMIT_WAIT_MS - waited,
        backoffIndex,
      });
      if (decision.action === "wait") {
        deps.log?.({
          event: "ai_rate_limit_wait",
          provider,
          attempt: attempts,
          maxAttempts,
          httpStatus: 429,
          waitMs: decision.waitMs,
          totalWaitMs: waited + decision.waitMs,
          outcome: "rate_limited_wait",
        });
        await sleep(decision.waitMs);
        waited += decision.waitMs;
        backoffIndex += 1;
        continue;
      }
      outcome.stop = decision;
      deps.log?.({
        event: "ai_retry_stop",
        provider,
        attempt: attempts,
        maxAttempts,
        httpStatus: 429,
        totalWaitMs: waited,
        outcome: decision.errorCode,
      });
      break;
    }
    if (outcome.kind !== "failure" || outcome.error.code !== "UNREACHABLE") {
      break;
    }
  }

  return { outcome, attempts, totalWaitMs: waited };
}

type ErrorBodyHints = {
  mentionsModel: boolean;
  mentionsUrl: boolean;
  mentionsPermission: boolean;
};

function readErrorBodyHints(bodyText: string | null): ErrorBodyHints {
  if (bodyText === null) {
    return { mentionsModel: false, mentionsUrl: false, mentionsPermission: false };
  }
  const text = bodyText.toLowerCase();
  const mentionsModel =
    /\bmodel\b/.test(text) &&
    /(not_found|not found|exist|unavailable|decommissioned|deprecated|invalid|unknown|missing|no such|try pulling|pull)/.test(
      text,
    );
  const mentionsUrl =
    /(unknown (request )?url|invalid url|check the url|no route|route not found|url not found|endpoint not found|unknown request)/.test(
      text,
    );
  const mentionsPermission =
    /(permission|forbidden|not allowed|insufficient|access denied|scope)/.test(text);
  return { mentionsModel, mentionsUrl, mentionsPermission };
}

function classifyChatStatus(
  status: number,
  model: string,
  bodyText: string | null,
): { code: string; message: string } {
  const hints = readErrorBodyHints(bodyText);

  if (status === 401) {
    return {
      code: "INVALID_CREDENTIALS",
      message: "Provider rejected the credentials (HTTP 401). Check the API key.",
    };
  }
  if (status === 403) {
    if (hints.mentionsPermission) {
      return {
        code: "INSUFFICIENT_PERMISSIONS",
        message:
          "Provider denied access (HTTP 403). The API key may lack permission for this model or endpoint.",
      };
    }
    return {
      code: "INVALID_CREDENTIALS",
      message: "Provider rejected the credentials (HTTP 403). Check the API key.",
    };
  }
  if (status === 405) {
    return {
      code: "ENDPOINT_NOT_FOUND",
      message: "Provider returned 405 for its chat endpoint. Check the base URL.",
    };
  }
  if (status === 404) {
    if (hints.mentionsModel) {
      return {
        code: "MODEL_NOT_FOUND",
        message: `Provider reports the requested model "${model}" is unavailable (HTTP 404). Check the model ID.`,
      };
    }
    if (hints.mentionsUrl) {
      return {
        code: "ENDPOINT_NOT_FOUND",
        message: "Provider returned 404 for its chat endpoint. Check the base URL.",
      };
    }
    return {
      code: "ENDPOINT_NOT_FOUND",
      message:
        "Provider returned 404. Either the base URL / chat endpoint is wrong, or the model ID is unavailable — check the base URL first, then the model ID.",
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Provider rate-limited the test message (HTTP 429).",
    };
  }
  if (status === 400 || status === 422) {
    if (hints.mentionsModel) {
      return {
        code: "MODEL_NOT_FOUND",
        message: `Provider rejected the request because the model "${model}" is unavailable. Check the model ID.`,
      };
    }
    return {
      code: "INVALID_REQUEST",
      message: `Provider rejected the test message (HTTP ${status}). Check the model ID.`,
    };
  }
  if (status >= 500) {
    return {
      code: "PROVIDER_ERROR",
      message: `Provider reported a server error (HTTP ${status}).`,
    };
  }
  return { code: "PROVIDER_ERROR", message: `Provider responded with HTTP ${status}.` };
}

function resultFromReply(
  provider: AiProviderId,
  model: string,
  outcome: ReplyOutcome,
  meta: { attempts: number; totalWaitMs: number },
): AiConnectionResult {
  if (outcome.kind === "reply") {
    return {
      ok: true,
      provider,
      latencyMs: outcome.latencyMs,
      detail: `Live reply from "${model}": "${truncateReply(outcome.reply)}".`,
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  if (outcome.kind === "rate-limit") {
    const decision: RateLimitDecision = outcome.stop ?? {
      action: "stop",
      errorCode: "RATE_LIMITED",
      status: "RATE_LIMIT_WAIT",
    };
    const info = rateLimitError(decision, outcome.info);
    return {
      ok: false,
      provider,
      latencyMs: outcome.latencyMs,
      error: info.error,
      status: info.status,
      retryAfterSeconds: info.retryAfterSeconds,
      rateLimitKind: outcome.info.kind,
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  if (outcome.kind === "http-error") {
    return {
      ok: false,
      provider,
      latencyMs: outcome.latencyMs,
      error: classifyChatStatus(outcome.status, model, outcome.bodyText),
      attempts: meta.attempts,
      totalWaitMs: meta.totalWaitMs,
    };
  }
  return {
    ok: false,
    provider,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
    attempts: meta.attempts,
    totalWaitMs: meta.totalWaitMs,
  };
}

export function createProviderAdapter(info: AiProviderInfo): AiProviderAdapter {
  return {
    ...info,
    async test(config, fetchImpl, deps = {}) {
      const baseUrl = trimTrailingSlash(config.baseUrl);
      const timeoutMs = clampTimeoutMs(config.timeoutMs);
      const maxRetries = clampMaxRetries(config.maxRetries);
      const model = config.model?.trim() ?? "";

      const headers: Record<string, string> = { accept: "application/json" };
      if (info.id === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
        if (config.apiKey) {
          headers["x-api-key"] = config.apiKey;
        }
      } else if (config.apiKey) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }
      if (config.organizationId && (info.id === "openai" || info.id === "custom")) {
        headers["openai-organization"] = config.organizationId;
      }

      if (model.length > 0) {
        const spec: ChatSpec =
          info.id === "ollama"
            ? {
                url: `${baseUrl}/api/chat`,
                payload: {
                  model,
                  messages: [{ role: "user", content: TEST_MESSAGE }],
                  stream: false,
                },
                extractReply: extractOllamaReply,
              }
            : info.id === "anthropic"
              ? {
                  url: `${baseUrl}/messages`,
                  payload: {
                    model,
                    max_tokens: 16,
                    messages: [{ role: "user", content: TEST_MESSAGE }],
                  },
                  extractReply: extractAnthropicReply,
                }
              : {
                  url: `${baseUrl}/chat/completions`,
                  payload: {
                    model,
                    max_tokens: 16,
                    temperature: 0,
                    stream: false,
                    messages: [{ role: "user", content: TEST_MESSAGE }],
                  },
                  extractReply: extractOpenAiReply,
                };

        const { outcome, attempts, totalWaitMs } = await sendTestMessageWithRetries(
          spec,
          headers,
          fetchImpl,
          timeoutMs,
          maxRetries,
          info.id,
          deps,
        );
        return resultFromReply(info.id, model, outcome, { attempts, totalWaitMs });
      }

      if (info.id === "ollama") {
        const { outcome, attempts, totalWaitMs } = await probeWithRetries(
          `${baseUrl}/api/tags`,
          headers,
          fetchImpl,
          timeoutMs,
          maxRetries,
          info.id,
          deps,
        );
        return resultFromProbe(
          info.id,
          outcome,
          "Connected to Ollama. Model list endpoint responded — set a model ID for a live reply test.",
          { attempts, totalWaitMs },
        );
      }

      const { outcome, attempts, totalWaitMs } = await probeWithRetries(
        `${baseUrl}/models`,
        headers,
        fetchImpl,
        timeoutMs,
        maxRetries,
        info.id,
        deps,
      );
      return resultFromProbe(
        info.id,
        outcome,
        `Connected to ${info.label}. Model list endpoint responded — set a model ID for a live reply test.`,
        { attempts, totalWaitMs },
      );
    },
  };
}

const ADAPTER_INFOS: AiProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    allowsLocalNetwork: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    allowsLocalNetwork: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    allowsLocalNetwork: false,
  },
  {
    id: "groq",
    label: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresApiKey: true,
    allowsLocalNetwork: false,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    defaultBaseUrl: "http://127.0.0.1:11434",
    requiresApiKey: false,
    allowsLocalNetwork: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    defaultBaseUrl: "",
    requiresApiKey: false,
    allowsLocalNetwork: false,
  },
];

const ADAPTERS = new Map<AiProviderId, AiProviderAdapter>(
  ADAPTER_INFOS.map((info) => [info.id, createProviderAdapter(info)]),
);

export function getProviderAdapter(id: AiProviderId): AiProviderAdapter {
  const adapter = ADAPTERS.get(id);
  if (!adapter) {
    throw new Error(`No adapter registered for provider "${id}".`);
  }
  return adapter;
}

export function listProviderInfos(): AiProviderInfo[] {
  return ADAPTER_INFOS.map((info) => ({ ...info }));
}
