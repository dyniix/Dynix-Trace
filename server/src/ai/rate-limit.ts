export type RateLimitKind = "temporary" | "daily_quota" | "unknown";

export type RateLimitInfo = {
  kind: RateLimitKind;
  retryAfterMs: number | null;
  source: "retry-after" | "reset-header" | "none";
};

export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
export const CONSERVATIVE_BACKOFF_MS = [2000, 4000, 8000, 16000] as const;

const MAX_PLAUSIBLE_WAIT_MS = 24 * 60 * 60 * 1000;

export function parseRetryAfterHeader(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, MAX_PLAUSIBLE_WAIT_MS);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.min(Math.max(dateMs - nowMs, 0), MAX_PLAUSIBLE_WAIT_MS);
}

export function parseDurationString(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const unitPattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  for (const match of trimmed.matchAll(unitPattern)) {
    matched = true;
    const amount = Number.parseFloat(match[1]);
    const unit = match[2];
    const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
    total += amount * factor;
  }
  if (!matched) return null;
  return Math.min(total, MAX_PLAUSIBLE_WAIT_MS);
}

const DAILY_QUOTA_PATTERN =
  /(per day|daily|tokens per day|requests per day|\btpd\b|\brpd\b|\bquota\b)/i;

export function classifyRateLimitBody(bodyText: string | null): RateLimitKind {
  if (bodyText === null) return "unknown";
  return DAILY_QUOTA_PATTERN.test(bodyText) ? "daily_quota" : "temporary";
}

export function readRateLimitInfo(
  status: number,
  headers: { get(name: string): string | null },
  bodyText: string | null,
  nowMs: number,
): RateLimitInfo | null {
  if (status !== 429) return null;

  const retryAfterMs = parseRetryAfterHeader(headers.get("retry-after"), nowMs);
  const resetHeaderMs =
    retryAfterMs === null
      ? (parseDurationString(headers.get("x-ratelimit-reset-tokens")) ??
        parseDurationString(headers.get("x-ratelimit-reset-requests")))
      : null;
  const resolvedMs = retryAfterMs ?? resetHeaderMs;

  return {
    kind: classifyRateLimitBody(bodyText),
    retryAfterMs: resolvedMs,
    source: retryAfterMs !== null ? "retry-after" : resetHeaderMs !== null ? "reset-header" : "none",
  };
}

export type RateLimitDecision =
  | { action: "wait"; waitMs: number }
  | {
      action: "stop";
      errorCode: "RATE_LIMITED" | "QUOTA_EXHAUSTED";
      status: "RATE_LIMIT_WAIT" | "AI_TEMPORARILY_UNAVAILABLE";
    };

export function decideRateLimitAction(args: {
  info: RateLimitInfo;
  attemptsUsed: number;
  maxRetries: number;
  budgetLeftMs: number;
  backoffIndex: number;
}): RateLimitDecision {
  if (args.info.kind === "daily_quota") {
    return { action: "stop", errorCode: "QUOTA_EXHAUSTED", status: "AI_TEMPORARILY_UNAVAILABLE" };
  }

  const retriesLeft = args.maxRetries - (args.attemptsUsed - 1);
  if (retriesLeft <= 0) {
    return { action: "stop", errorCode: "RATE_LIMITED", status: "RATE_LIMIT_WAIT" };
  }

  const waitMs =
    args.info.retryAfterMs !== null
      ? args.info.retryAfterMs
      : CONSERVATIVE_BACKOFF_MS[Math.min(args.backoffIndex, CONSERVATIVE_BACKOFF_MS.length - 1)];

  if (waitMs > args.budgetLeftMs) {
    return { action: "stop", errorCode: "RATE_LIMITED", status: "RATE_LIMIT_WAIT" };
  }

  return { action: "wait", waitMs };
}
