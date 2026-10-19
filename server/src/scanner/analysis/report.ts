import type { Finding, ProcessEvidence, ScanJob } from "../contracts.ts";
import { classifyExecutablePath, observedString, resolvePathOptions, type PathOptions } from "./rules.ts";
import { computeIntegrityRisk, type IntegrityRisk } from "./risk.ts";

/**
 * Aggregate, evidence-only statistics for the report page. Everything here
 * is counted from persisted evidence records; nothing is estimated.
 */
export type ScanReportStats = {
  evidenceRecords: number;
  evidenceTruncated: boolean;
  signatures: {
    valid: number;
    unsigned: number;
    invalid: number;
    unknown: number;
    unavailable: number;
    notChecked: number;
  };
  hashes: {
    present: number;
    missing: number;
  };
  paths: {
    withPath: number;
    withoutPath: number;
    system: number;
    userWritable: number;
    temp: number;
    other: number;
  };
};

export type ScanReport = {
  generatedAt: string;
  job: ScanJob;
  findings: Finding[];
  risk: IntegrityRisk;
  stats: ScanReportStats;
};

const VALUE_BEARING_HASH_STATUSES = new Set(["OBSERVED", "VERIFIED", "INFERRED"]);

export function summarizeEvidence(
  evidence: readonly ProcessEvidence[],
  options: PathOptions = {},
): ScanReportStats {
  const resolved = resolvePathOptions(options);
  const stats: ScanReportStats = {
    evidenceRecords: evidence.length,
    evidenceTruncated: false,
    signatures: { valid: 0, unsigned: 0, invalid: 0, unknown: 0, unavailable: 0, notChecked: 0 },
    hashes: { present: 0, missing: 0 },
    paths: { withPath: 0, withoutPath: 0, system: 0, userWritable: 0, temp: 0, other: 0 },
  };

  for (const record of evidence) {
    const executable = record.executable;
    if (executable === null) {
      stats.signatures.notChecked += 1;
      stats.hashes.missing += 1;
    } else {
      switch (executable.signature.status) {
        case "VALID":
          stats.signatures.valid += 1;
          break;
        case "UNSIGNED":
          stats.signatures.unsigned += 1;
          break;
        case "INVALID":
          stats.signatures.invalid += 1;
          break;
        case "UNKNOWN":
          stats.signatures.unknown += 1;
          break;
        case "UNAVAILABLE":
          stats.signatures.unavailable += 1;
          break;
      }
      if (
        executable.sha256.value !== null &&
        VALUE_BEARING_HASH_STATUSES.has(executable.sha256.status)
      ) {
        stats.hashes.present += 1;
      } else {
        stats.hashes.missing += 1;
      }
    }

    const path = observedString(record.executablePath.value);
    if (path === null) {
      stats.paths.withoutPath += 1;
      continue;
    }
    stats.paths.withPath += 1;
    switch (classifyExecutablePath(path, resolved)) {
      case "system":
        stats.paths.system += 1;
        break;
      case "user-writable":
        stats.paths.userWritable += 1;
        break;
      case "temp":
        stats.paths.temp += 1;
        break;
      case "other":
        stats.paths.other += 1;
        break;
    }
  }

  return stats;
}

export function buildScanReport(input: {
  job: ScanJob;
  findings: readonly Finding[];
  evidence: readonly ProcessEvidence[];
  evidenceTruncated?: boolean;
  generatedAt: string;
  pathOptions?: PathOptions;
}): ScanReport {
  const stats = summarizeEvidence(input.evidence, input.pathOptions ?? {});
  stats.evidenceTruncated = input.evidenceTruncated ?? false;
  return {
    generatedAt: input.generatedAt,
    job: input.job,
    findings: [...input.findings],
    risk: computeIntegrityRisk(input.findings),
    stats,
  };
}
