import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../errors.ts";

export type UrlGuardOptions = {
  allowLocalNetwork: boolean;
};

type AddressScope = "loopback" | "private" | "link-local" | "reserved" | "public";

const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);

function ipv4Scope(parts: number[]): AddressScope {
  const [a, b, c] = parts;
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 0 || a >= 224) return "reserved";
  if (a === 100 && b >= 64 && b <= 127) return "reserved";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if (a === 192 && b === 0 && c === 2) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a === 198 && b === 51 && c === 100) return "reserved";
  if (a === 203 && b === 0 && c === 113) return "reserved";
  return "public";
}

function ipv6Scope(value: string): AddressScope {
  if (value === "::1") return "loopback";
  if (value === "::" || value.startsWith("ff")) return "reserved";
  if (/^fe[89ab]/.test(value)) return "link-local";
  if (value.startsWith("fc") || value.startsWith("fd")) return "private";
  return "public";
}

function scopeOfAddress(address: string): AddressScope {
  const version = isIP(address);
  if (version === 4) {
    return ipv4Scope(address.split(".").map(Number));
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) {
      return ipv4Scope(mapped[1].split(".").map(Number));
    }
    return ipv6Scope(lower);
  }
  return "reserved";
}

function localBlockedError(hostname: string): AppError {
  return new AppError(
    "BLOCKED_ADDRESS",
    400,
    `Host "${hostname}" points to a local or private address. Use a local provider (for example Ollama) or set DYNIX_ALLOW_LOCAL_AI=true for a trusted local setup.`,
  );
}

function enforceScope(scope: AddressScope, hostname: string, allowLocal: boolean): void {
  if (scope === "public") return;
  if (scope === "link-local") {
    throw new AppError(
      "BLOCKED_ADDRESS",
      400,
      `Link-local address "${hostname}" is not an acceptable AI provider endpoint.`,
    );
  }
  if (scope === "reserved") {
    throw new AppError(
      "BLOCKED_ADDRESS",
      400,
      `Reserved address "${hostname}" is not an acceptable AI provider endpoint.`,
    );
  }
  if (!allowLocal) {
    throw localBlockedError(hostname);
  }
}

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function assertSafeBaseUrl(rawValue: string, options: UrlGuardOptions): URL {
  const value = rawValue.trim();
  if (value.length === 0) {
    throw new AppError("INVALID_BASE_URL", 400, "Base URL is required.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_BASE_URL", 400, `Base URL is not a valid absolute URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_BASE_URL", 400, "Base URL must use http:// or https://.");
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new AppError("INVALID_BASE_URL", 400, "Base URL must not embed credentials.");
  }

  const hostname = normalizeHostname(url.hostname);

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new AppError(
      "BLOCKED_ADDRESS",
      400,
      `Host "${hostname}" is a cloud metadata endpoint and is never allowed.`,
    );
  }

  if (isIP(hostname) !== 0) {
    enforceScope(scopeOfAddress(hostname), hostname, options.allowLocalNetwork);
  } else if (hostname === "localhost" && !options.allowLocalNetwork) {
    throw localBlockedError(hostname);
  }

  return url;
}

export async function assertSafeResolvedHost(url: URL, options: UrlGuardOptions): Promise<void> {
  const hostname = normalizeHostname(url.hostname);

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new AppError(
      "BLOCKED_ADDRESS",
      400,
      `Host "${hostname}" is a cloud metadata endpoint and is never allowed.`,
    );
  }

  if (isIP(hostname) !== 0) {
    enforceScope(scopeOfAddress(hostname), hostname, options.allowLocalNetwork);
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError("UNRESOLVABLE_HOST", 400, `Host "${hostname}" could not be resolved.`);
  }

  if (addresses.length === 0) {
    throw new AppError(
      "UNRESOLVABLE_HOST",
      400,
      `Host "${hostname}" did not resolve to any address.`,
    );
  }

  for (const entry of addresses) {
    enforceScope(scopeOfAddress(entry.address), hostname, options.allowLocalNetwork);
  }
}
