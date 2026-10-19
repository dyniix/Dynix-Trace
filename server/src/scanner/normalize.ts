import {
  processEvidenceSchema,
  type CollectorProvenance,
  type EvidenceField,
  type ExecutableEvidence,
  type ExecutableSignature,
  type ProcessEvidence,
  type ScanWarning,
} from "./contracts.ts";
import type {
  NormalizedCollection,
  ProcessCollectionOutcome,
  RawExecutableMetadata,
  RawFieldIssue,
  RawProcessRecord,
} from "./ports.ts";

export type NormalizeContext = {
  scanId: string;
  collectionTimestamp: string;
  source: CollectorProvenance;
};

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function warning(code: ScanWarning["code"], message: string): ScanWarning {
  return { code, message, occurrences: 1 };
}

function mapField<T>(
  value: T | null | undefined,
  issue: RawFieldIssue | undefined,
  note?: string,
): EvidenceField<T | null> {
  if (issue !== undefined) {
    return { value: null, status: issue };
  }
  if (value === null || value === undefined) {
    return note === undefined ? { value: null, status: "UNKNOWN" } : { value: null, status: "UNKNOWN", note };
  }
  return note === undefined ? { value, status: "OBSERVED" } : { value, status: "OBSERVED", note };
}

function asNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSignature(raw: RawExecutableMetadata | null | undefined): {
  signature: ExecutableSignature;
  warnings: ScanWarning[];
} {
  const method = raw?.signatureMethod ?? "none";
  let status = raw?.signatureStatus ?? "UNKNOWN";
  let signerName = asNonEmptyString(raw?.signerName ?? null);
  const warnings: ScanWarning[] = [];

  if (method === "none" && (status === "VALID" || status === "INVALID" || status === "UNSIGNED")) {
    warnings.push(
      warning(
        "SIGNATURE_CHECK_UNAVAILABLE",
        "A signature result was reported without a verification method, so it was not trusted.",
      ),
    );
    status = "UNKNOWN";
  }
  if (status === "UNSIGNED" || status === "UNKNOWN" || status === "UNAVAILABLE") {
    signerName = null;
  }
  return { signature: { status, method, signerName }, warnings };
}

function normalizeExecutableMetadata(
  raw: RawExecutableMetadata,
  context: NormalizeContext,
  processId: number,
  observedPath: string | null,
): { executable: ExecutableEvidence; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];
  const fieldIssues = raw.fieldIssues ?? {};

  let sizeValue = raw.fileSizeBytes ?? null;
  if (sizeValue !== null && (!Number.isInteger(sizeValue) || sizeValue < 0)) {
    warnings.push(
      warning(
        "EXECUTABLE_METADATA_UNAVAILABLE",
        "A reported file size was invalid and was discarded.",
      ),
    );
    sizeValue = null;
  }

  let createdAtValue = asNonEmptyString(raw.createdAt ?? null);
  if (createdAtValue !== null && !ISO_UTC_PATTERN.test(createdAtValue)) {
    warnings.push(
      warning(
        "EXECUTABLE_METADATA_UNAVAILABLE",
        "A reported creation timestamp did not match ISO-8601 UTC and was discarded.",
      ),
    );
    createdAtValue = null;
  }

  let modifiedAtValue = asNonEmptyString(raw.modifiedAt ?? null);
  if (modifiedAtValue !== null && !ISO_UTC_PATTERN.test(modifiedAtValue)) {
    warnings.push(
      warning(
        "EXECUTABLE_METADATA_UNAVAILABLE",
        "A reported modification timestamp did not match ISO-8601 UTC and was discarded.",
      ),
    );
    modifiedAtValue = null;
  }

  let sha256Value = asNonEmptyString(raw.sha256 ?? null)?.toLowerCase() ?? null;
  if (sha256Value !== null && !SHA256_PATTERN.test(sha256Value)) {
    warnings.push(
      warning(
        "HASH_FAILED",
        "A reported SHA-256 did not match the expected format and was discarded.",
      ),
    );
    sha256Value = null;
  }

  const signature = normalizeSignature(raw);
  warnings.push(...signature.warnings);

  return {
    executable: {
      evidenceId: `${context.scanId}:exec:${processId}`,
      path: observedPath,
      fileSizeBytes: mapField(sizeValue, fieldIssues.fileSizeBytes),
      createdAt: mapField(createdAtValue, fieldIssues.createdAt),
      modifiedAt: mapField(modifiedAtValue, fieldIssues.modifiedAt),
      sha256: mapField(sha256Value, fieldIssues.sha256),
      signature: signature.signature,
      limitations: [],
    },
    warnings,
  };
}

export function normalizeProcessRecord(
  record: RawProcessRecord,
  context: NormalizeContext,
): { evidence: ProcessEvidence | null; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];

  if (!Number.isInteger(record.processId) || record.processId < 0) {
    return {
      evidence: null,
      warnings: [
        warning(
          "RAW_RECORD_INVALID",
          "A process record without a valid process ID was excluded from the inventory.",
        ),
      ],
    };
  }

  const fieldIssues = record.fieldIssues ?? {};
  const executablePath = asNonEmptyString(record.executablePath);
  if (executablePath === null && fieldIssues.executablePath === undefined) {
    warnings.push(
      warning(
        "EXECUTABLE_PATH_UNAVAILABLE",
        `No executable path was reported for process ${record.processId}.`,
      ),
    );
  }

  let executable: ExecutableEvidence | null = null;
  if (record.executable) {
    const normalized = normalizeExecutableMetadata(
      record.executable,
      context,
      record.processId,
      executablePath,
    );
    executable = normalized.executable;
    warnings.push(...normalized.warnings);
  }

  const candidate: ProcessEvidence = {
    evidenceId: `${context.scanId}:proc:${record.processId}`,
    scanId: context.scanId,
    processId: record.processId,
    parentProcessId: mapField(record.parentProcessId, fieldIssues.parentProcessId),
    processName: mapField(asNonEmptyString(record.processName), fieldIssues.processName),
    executablePath: mapField(
      executablePath,
      fieldIssues.executablePath,
      executablePath === null && fieldIssues.executablePath === undefined
        ? "No executable path was reported."
        : undefined,
    ),
    processStartTime: mapField(
      asNonEmptyString(record.processStartTime),
      fieldIssues.processStartTime,
    ),
    collectionTimestamp: context.collectionTimestamp,
    executable,
    source: context.source,
    limitations: [],
  };

  const parsed = processEvidenceSchema.safeParse(candidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      evidence: null,
      warnings: [
        warning(
          "RAW_RECORD_INVALID",
          `Process ${record.processId} failed contract validation (${firstIssue?.path.join(".") ?? "unknown field"}) and was excluded.`,
        ),
      ],
    };
  }
  return { evidence: parsed.data, warnings };
}

function aggregateWarnings(warnings: ScanWarning[]): ScanWarning[] {
  const byCode = new Map<string, ScanWarning>();
  for (const item of warnings) {
    const existing = byCode.get(item.code);
    if (existing) {
      existing.occurrences += item.occurrences;
    } else {
      byCode.set(item.code, { ...item });
    }
  }
  return [...byCode.values()];
}

export function normalizeCollection(
  outcome: ProcessCollectionOutcome,
  context: NormalizeContext,
): NormalizedCollection {
  const processes: ProcessEvidence[] = [];
  const warnings: ScanWarning[] = [...outcome.warnings];
  const limitations: string[] = [...outcome.limitations];

  for (const record of outcome.records) {
    const normalized = normalizeProcessRecord(record, context);
    warnings.push(...normalized.warnings);
    if (normalized.evidence !== null) {
      processes.push(normalized.evidence);
    }
  }

  if (!outcome.complete) {
    warnings.push(
      warning(
        "PARTIAL_INVENTORY",
        "Some processes could not be fully inspected; this inventory is partial.",
      ),
    );
    limitations.push(
      "Some processes could not be fully inspected; this inventory is partial and does not describe what was missed.",
    );
  }
  if (context.source === "mocked") {
    limitations.push(
      "Mocked collector: this evidence is simulated test data and does not describe the real system.",
    );
  }

  return {
    processes,
    warnings: aggregateWarnings(warnings).slice(0, 50),
    limitations: [...new Set(limitations)].slice(0, 20),
  };
}
