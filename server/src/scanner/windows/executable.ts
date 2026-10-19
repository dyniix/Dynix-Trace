import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ExecutableCollectionOutcome, ExecutableMetadataCollector, RawExecutableMetadata } from "../ports.ts";
import type { ScanWarning, SignatureStatus } from "../contracts.ts";
import { createPowerShellRunner, type PowerShellRunner } from "./powershell.ts";

export const SIGNATURE_QUERY_TIMEOUT_MS = 20000;
export const HASH_READ_CHUNK_BYTES = 1024 * 1024;

export const SIGNATURE_QUERY_SCRIPT = `
$target = $env:DYNIX_TRACE_SIGNATURE_TARGET
if ([string]::IsNullOrWhiteSpace($target)) {
  Write-Output '{"status":"Unavailable","subject":null}'
  exit 0
}
try {
  $sig = Get-AuthenticodeSignature -LiteralPath $target -ErrorAction Stop
  $subject = $null
  if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }
  [pscustomobject]@{ status = [string]$sig.Status; subject = $subject } | ConvertTo-Json -Compress
} catch {
  Write-Output '{"status":"Error","subject":null}'
}
`.trim();

export function mapAuthenticodeStatus(status: string): SignatureStatus {
  switch (status) {
    case "Valid":
      return "VALID";
    case "NotSigned":
      return "UNSIGNED";
    case "HashMismatch":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

function warning(code: ScanWarning["code"], message: string): ScanWarning {
  return { code, message, occurrences: 1 };
}

async function sha256File(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; hash: string } | { ok: false; reason: "ACCESS_DENIED" | "UNAVAILABLE" | "ABORTED" }> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: HASH_READ_CHUNK_BYTES });
    stream.on("data", (chunk) => {
      if (signal?.aborted) {
        stream.destroy();
        return;
      }
      hash.update(chunk);
    });
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (signal?.aborted) {
        resolve({ ok: false, reason: "ABORTED" });
        return;
      }
      if (error.code === "EACCES" || error.code === "EPERM") {
        resolve({ ok: false, reason: "ACCESS_DENIED" });
        return;
      }
      resolve({ ok: false, reason: "UNAVAILABLE" });
    });
    stream.on("close", () => {
      if (signal?.aborted) {
        resolve({ ok: false, reason: "ABORTED" });
        return;
      }
      resolve({ ok: true, hash: hash.digest("hex") });
    });
  });
}

function issueFromStatError(error: NodeJS.ErrnoException): "ACCESS_DENIED" | "UNAVAILABLE" {
  return error.code === "EACCES" || error.code === "EPERM" ? "ACCESS_DENIED" : "UNAVAILABLE";
}

export function createExecutableMetadataCollector(
  runner: PowerShellRunner = createPowerShellRunner(),
): ExecutableMetadataCollector {
  return {
    provenance: "windows-native",
    async collectExecutableMetadata({ executablePath, context }): Promise<ExecutableCollectionOutcome> {
      const warnings: ScanWarning[] = [];
      const metadata: RawExecutableMetadata = {};
      const fieldIssues: NonNullable<RawExecutableMetadata["fieldIssues"]> = {};

      let size: number | null = null;
      try {
        const stats = await stat(executablePath);
        size = stats.size;
        metadata.createdAt =
          Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
            ? new Date(stats.birthtimeMs).toISOString()
            : null;
        metadata.modifiedAt =
          Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0
            ? new Date(stats.mtimeMs).toISOString()
            : null;
      } catch (error) {
        const code = issueFromStatError(error as NodeJS.ErrnoException);
        fieldIssues.fileSizeBytes = code;
        fieldIssues.createdAt = code;
        fieldIssues.modifiedAt = code;
        warnings.push(
          warning(
            "EXECUTABLE_METADATA_UNAVAILABLE",
            `File metadata for "${executablePath}" could not be read (${code}).`,
          ),
        );
      }
      metadata.fileSizeBytes = size;

      if (context.signal?.aborted) {
        const abort = new Error("The scan was cancelled.");
        abort.name = "AbortError";
        throw abort;
      }

      const hashed = await sha256File(executablePath, context.signal);
      if (hashed.ok) {
        metadata.sha256 = hashed.hash;
      } else if (hashed.reason === "ABORTED") {
        const abort = new Error("The scan was cancelled.");
        abort.name = "AbortError";
        throw abort;
      } else {
        fieldIssues.sha256 = hashed.reason;
        warnings.push(
          warning(
            hashed.reason === "ACCESS_DENIED" ? "HASH_UNAVAILABLE" : "HASH_FAILED",
            `A SHA-256 hash for "${executablePath}" could not be computed (${hashed.reason}).`,
          ),
        );
      }

      const signature = await runner.run(SIGNATURE_QUERY_SCRIPT, {
        timeoutMs: SIGNATURE_QUERY_TIMEOUT_MS,
        signal: context.signal,
        env: { DYNIX_TRACE_SIGNATURE_TARGET: executablePath },
      });
      if (!signature.ok) {
        metadata.signatureStatus = "UNAVAILABLE";
        metadata.signatureMethod = "none";
        metadata.signerName = null;
        warnings.push(
          warning(
            "SIGNATURE_CHECK_UNAVAILABLE",
            `The digital signature of "${executablePath}" could not be verified (${signature.code}).`,
          ),
        );
      } else {
        let parsedStatus = "Error";
        let parsedSubject: string | null = null;
        try {
          const parsed = JSON.parse(signature.stdout.trim()) as {
            status?: unknown;
            subject?: unknown;
          };
          if (typeof parsed.status === "string") {
            parsedStatus = parsed.status;
          }
          if (typeof parsed.subject === "string" && parsed.subject.trim().length > 0) {
            parsedSubject = parsed.subject.slice(0, 200);
          }
        } catch {
          parsedStatus = "Error";
        }
        metadata.signatureStatus = mapAuthenticodeStatus(parsedStatus);
        metadata.signatureMethod = "windows-authenticode";
        metadata.signerName = metadata.signatureStatus === "VALID" ? parsedSubject : null;
      }

      metadata.fieldIssues = fieldIssues;
      return { metadata, warnings, limitations: [] };
    },
  };
}
