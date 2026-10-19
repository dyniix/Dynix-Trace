import { z } from "zod";
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from "../domain.ts";
import { AppError } from "../errors.ts";
import { SCAN_LIFECYCLE_STATUSES } from "./lifecycle.ts";

export const COLLECTOR_PROVENANCE = ["windows-native", "mocked"] as const;
export type CollectorProvenance = (typeof COLLECTOR_PROVENANCE)[number];

/**
 * How confidently a piece of evidence is known. UNKNOWN and the access
 * statuses below must never be reported as a known value.
 *
 * - OBSERVED: read directly from the operating system during collection.
 * - VERIFIED: confirmed through an authoritative source (for example an OS
 *   signature API) rather than a single field read.
 * - INFERRED: derived from other observed data; the derivation must be
 *   stated, it is not a direct observation.
 * - UNKNOWN: could not be determined.
 */
export const EVIDENCE_INFORMATION_LEVELS = [
  "OBSERVED",
  "VERIFIED",
  "INFERRED",
  "UNKNOWN",
] as const;
export type EvidenceInformationLevel = (typeof EVIDENCE_INFORMATION_LEVELS)[number];

/**
 * Field-level verification/access status. Beyond the information levels:
 *
 * - UNAVAILABLE: the platform or engine cannot provide this field at all.
 * - ACCESS_DENIED: the operating system refused access for this field.
 * - NOT_APPLICABLE: the field does not apply to this record.
 * - PROCESS_EXITED: the process disappeared during collection, so the field
 *   could not be read while it was alive.
 */
export const EVIDENCE_FIELD_STATUSES = [
  ...EVIDENCE_INFORMATION_LEVELS,
  "UNAVAILABLE",
  "ACCESS_DENIED",
  "NOT_APPLICABLE",
  "PROCESS_EXITED",
] as const;
export type EvidenceFieldStatus = (typeof EVIDENCE_FIELD_STATUSES)[number];

const VALUE_BEARING_STATUSES: readonly EvidenceFieldStatus[] = [
  "OBSERVED",
  "VERIFIED",
  "INFERRED",
];

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isoUtc = z.string().regex(ISO_UTC_PATTERN, "Expected an ISO-8601 UTC timestamp.");

export const SCAN_PROGRESS_STAGES = [
  "INITIALIZING",
  "ENUMERATING_PROCESSES",
  "COLLECTING_PROCESS_METADATA",
  "INSPECTING_EXECUTABLES",
  "PERSISTING_EVIDENCE",
  "FINALIZING",
] as const;
export type ScanProgressStage = (typeof SCAN_PROGRESS_STAGES)[number];

export const scanProgressSchema = z
  .strictObject({
    stage: z.enum(SCAN_PROGRESS_STAGES),
    stageIndex: z.number().int().min(0).max(SCAN_PROGRESS_STAGES.length - 1),
    totalStages: z.literal(SCAN_PROGRESS_STAGES.length),
  })
  .superRefine((progress, ctx) => {
    if (progress.stageIndex !== SCAN_PROGRESS_STAGES.indexOf(progress.stage)) {
      ctx.addIssue({
        code: "custom",
        path: ["stageIndex"],
        message: "stageIndex must match the position of stage.",
      });
    }
  });
export type ScanProgress = z.infer<typeof scanProgressSchema>;

export const SCAN_WARNING_CODES = [
  "PROCESS_ACCESS_DENIED",
  "PROCESS_EXITED_DURING_COLLECTION",
  "EXECUTABLE_PATH_UNAVAILABLE",
  "EXECUTABLE_METADATA_UNAVAILABLE",
  "HASH_FAILED",
  "HASH_UNAVAILABLE",
  "SIGNATURE_CHECK_UNAVAILABLE",
  "SIGNATURE_CHECK_UNSUPPORTED",
  "RAW_RECORD_INVALID",
  "PARTIAL_INVENTORY",
] as const;
export type ScanWarningCode = (typeof SCAN_WARNING_CODES)[number];

export const scanWarningSchema = z.strictObject({
  code: z.enum(SCAN_WARNING_CODES),
  message: z.string().min(1).max(300),
  occurrences: z.number().int().min(1),
});
export type ScanWarning = z.infer<typeof scanWarningSchema>;

type EvidenceFieldShape = {
  value: unknown;
  status: EvidenceFieldStatus;
  note?: string | undefined;
};

function checkEvidenceFieldConsistency(
  field: EvidenceFieldShape,
  ctx: z.RefinementCtx,
): void {
  const hasValue = field.value !== null && field.value !== undefined;
  const expectsValue = VALUE_BEARING_STATUSES.includes(field.status);
  if (expectsValue && !hasValue) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "A value is required when the status is OBSERVED, VERIFIED or INFERRED.",
    });
  }
  if (!expectsValue && hasValue) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "A value must not be present when the status carries no known value.",
    });
  }
}

export const EVIDENCE_VALUE_KINDS = ["string", "number", "timestamp", "hash"] as const;
export type EvidenceValueKind = (typeof EVIDENCE_VALUE_KINDS)[number];

function valueSchemaFor(kind: EvidenceValueKind) {
  switch (kind) {
    case "string":
      return z.string().min(1).max(600).nullable();
    case "number":
      return z.number().int().min(0).nullable();
    case "timestamp":
      return isoUtc.nullable();
    case "hash":
      return z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable();
  }
}

export function evidenceFieldSchema(kind: EvidenceValueKind) {
  return z
    .strictObject({
      value: valueSchemaFor(kind),
      status: z.enum(EVIDENCE_FIELD_STATUSES),
      note: z.string().min(1).max(300).optional(),
    })
    .superRefine(checkEvidenceFieldConsistency);
}

export type EvidenceField<T> = {
  value: T;
  status: EvidenceFieldStatus;
  note?: string;
};

export const SIGNATURE_STATUSES = [
  "VALID",
  "INVALID",
  "UNSIGNED",
  "UNKNOWN",
  "UNAVAILABLE",
] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const SIGNATURE_METHODS = ["windows-authenticode", "mock", "none"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const executableSignatureSchema = z
  .strictObject({
    status: z.enum(SIGNATURE_STATUSES),
    method: z.enum(SIGNATURE_METHODS),
    signerName: z.string().min(1).max(200).nullable(),
  })
  .superRefine((signature, ctx) => {
    if (signature.method === "none" && (signature.status === "VALID" || signature.status === "INVALID" || signature.status === "UNSIGNED")) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "A signature result requires a verification method other than none.",
      });
    }
    if (signature.status === "UNSIGNED" && signature.signerName !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["signerName"],
        message: "An unsigned executable has no signer name.",
      });
    }
    if ((signature.status === "UNKNOWN" || signature.status === "UNAVAILABLE") && signature.signerName !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["signerName"],
        message: "A signer name must not be claimed when the signature status is " + signature.status + ".",
      });
    }
  });
export type ExecutableSignature = z.infer<typeof executableSignatureSchema>;

export const executableEvidenceSchema = z.strictObject({
  evidenceId: z.string().min(1).max(120),
  path: z.string().min(1).max(600).nullable(),
  fileSizeBytes: evidenceFieldSchema("number"),
  createdAt: evidenceFieldSchema("timestamp"),
  modifiedAt: evidenceFieldSchema("timestamp"),
  sha256: evidenceFieldSchema("hash"),
  signature: executableSignatureSchema,
  limitations: z.array(z.string().min(1).max(300)).max(12),
});
export type ExecutableEvidence = z.infer<typeof executableEvidenceSchema>;

export const processEvidenceSchema = z.strictObject({
  evidenceId: z.string().min(1).max(120),
  scanId: z.string().min(1).max(64),
  processId: z.number().int().min(0),
  parentProcessId: evidenceFieldSchema("number"),
  processName: evidenceFieldSchema("string"),
  executablePath: evidenceFieldSchema("string"),
  processStartTime: evidenceFieldSchema("timestamp"),
  collectionTimestamp: isoUtc,
  executable: executableEvidenceSchema.nullable(),
  source: z.enum(COLLECTOR_PROVENANCE),
  limitations: z.array(z.string().min(1).max(300)).max(12),
});
export type ProcessEvidence = z.infer<typeof processEvidenceSchema>;

export const findingEvidenceReferenceSchema = z.strictObject({
  kind: z.enum(["process", "executable", "scan"]),
  refId: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
});
export type FindingEvidenceReference = z.infer<typeof findingEvidenceReferenceSchema>;

export const findingSchema = z.strictObject({
  findingId: z.string().min(1).max(64),
  scanId: z.string().min(1).max(64),
  ruleId: z.string().min(1).max(80),
  category: z.enum(FINDING_CATEGORIES),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: z.enum(FINDING_SEVERITIES),
  verificationStatus: z.enum(EVIDENCE_INFORMATION_LEVELS),
  evidenceReferences: z.array(findingEvidenceReferenceSchema).min(1).max(50),
  limitations: z.array(z.string().min(1).max(300)).max(12),
  alternativeExplanations: z.array(z.string().min(1).max(500)).max(8),
  createdAt: isoUtc,
});
export type Finding = z.infer<typeof findingSchema>;

export const scanJobSchema = z
  .strictObject({
    scanId: z.string().min(1).max(64),
    status: z.enum(SCAN_LIFECYCLE_STATUSES),
    platform: z.string().min(1).max(32),
    scannerVersion: z.string().min(1).max(40),
    collectorProvenance: z.enum(COLLECTOR_PROVENANCE),
    progress: scanProgressSchema.nullable(),
    checksAttempted: z.number().int().min(0).max(100000),
    checksCompleted: z.number().int().min(0).max(100000),
    processCount: z.number().int().min(0).max(100000),
    findingsCount: z.number().int().min(0).max(100000),
    warnings: z.array(scanWarningSchema).max(50),
    limitations: z.array(z.string().min(1).max(300)).max(20),
    error: z
      .strictObject({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(300),
      })
      .nullable(),
    createdAt: isoUtc,
    startedAt: isoUtc.nullable(),
    completedAt: isoUtc.nullable(),
  })
  .superRefine((job, ctx) => {
    if (job.checksCompleted > job.checksAttempted) {
      ctx.addIssue({
        code: "custom",
        path: ["checksCompleted"],
        message: "checksCompleted must not exceed checksAttempted.",
      });
    }
    if (job.status === "QUEUED" && (job.startedAt !== null || job.completedAt !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "A QUEUED scan has no start or completion timestamp.",
      });
    }
    if (job.status === "QUEUED" && job.progress !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["progress"],
        message: "A QUEUED scan reports no progress yet.",
      });
    }
    if (job.status === "RUNNING" && job.startedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "A RUNNING scan requires a start timestamp.",
      });
    }
    if (job.status === "RUNNING" && job.completedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A RUNNING scan has no completion timestamp.",
      });
    }
    if (
      (job.status === "COMPLETED" || job.status === "COMPLETED_WITH_WARNINGS" || job.status === "FAILED" || job.status === "CANCELLED") &&
      job.completedAt === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A terminal scan requires a completion timestamp.",
      });
    }
    if (job.status === "FAILED" && job.error === null) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "A FAILED scan must record a safe error reason.",
      });
    }
  });
export type ScanJob = z.infer<typeof scanJobSchema>;

export const scanRequestSchema = z.strictObject({});
export type ScanRequest = z.infer<typeof scanRequestSchema>;

function issuesOf(error: z.ZodError): unknown {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function parseScanJobContract(input: unknown): ScanJob {
  const parsed = scanJobSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_SCAN_JOB_CONTRACT",
      500,
      "Scan job does not match the scanner contract.",
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}

export function parseProcessEvidenceContract(input: unknown): ProcessEvidence {
  const parsed = processEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_PROCESS_EVIDENCE_CONTRACT",
      500,
      "Process evidence does not match the scanner contract.",
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}

export function parseFindingContract(input: unknown): Finding {
  const parsed = findingSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_FINDING_CONTRACT",
      500,
      "Finding does not match the scanner contract.",
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}
