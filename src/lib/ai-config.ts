export const DEFAULT_AI_API_URL = "http://127.0.0.1:3001";

export type AiProviderId = "openai" | "anthropic" | "openrouter" | "groq" | "ollama" | "custom";

export type AiProviderInfo = {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  allowsLocalNetwork: boolean;
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

export type AiConfigInput = {
  provider: AiProviderId;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  organizationId?: string | null;
};

export type AIConnectionStatus = "not_connected" | "testing" | "connected" | "failed";

export type AiConnectionTestResult = {
  ok: boolean;
  provider: AiProviderId;
  latencyMs: number;
  detail?: string;
  error?: { code: string; message: string };
};

export class AiApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AiApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function resolveDefaultBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_AI_API_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_AI_API_URL;
}

export const AI_API_URL = resolveDefaultBaseUrl();

export function createAiConfigClient(
  baseUrl: string = AI_API_URL,
  fetchImpl: FetchLike = fetch,
) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new AiApiError(
        "BACKEND_UNREACHABLE",
        0,
        "Local backend is not reachable. Start it with npm run dev inside the server/ directory.",
      );
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    let code = `HTTP_${response.status}`;
    let message = `Request failed with HTTP ${response.status}.`;
    let details: unknown;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (typeof body?.error?.code === "string") code = body.error.code;
      if (typeof body?.error?.message === "string") message = body.error.message;
      details = body?.error?.details;
    } catch {
      // Non-JSON error body - keep the HTTP status defaults.
    }
    throw new AiApiError(code, response.status, message, details);
  }

  return {
    getConfig: async (): Promise<AiConfigMetadata | null> =>
      (await request<{ config: AiConfigMetadata | null }>("/api/ai/config")).config,

    saveConfig: async (input: AiConfigInput): Promise<AiConfigMetadata> =>
      (
        await request<{ config: AiConfigMetadata }>("/api/ai/config", {
          method: "PUT",
          body: JSON.stringify(input),
        })
      ).config,

    resetConfig: async (): Promise<void> => {
      await request<{ config: null }>("/api/ai/config", { method: "DELETE" });
    },

    getProviders: async (): Promise<AiProviderInfo[]> =>
      (await request<{ providers: AiProviderInfo[] }>("/api/ai/providers")).providers,

    testConnection: async (input: AiConfigInput): Promise<AiConnectionTestResult> =>
      (
        await request<{ result: AiConnectionTestResult }>("/api/ai/config/test", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).result,
  };
}

export type AiConfigClient = ReturnType<typeof createAiConfigClient>;
