import type { Finding } from "../contracts.ts";
import {
  MASQUERADING_RULE_ID,
  TEMP_LOCATION_RULE_ID,
  UNSIGNED_USER_LOCATION_RULE_ID,
} from "./rules.ts";

/**
 * Deterministic heuristic risk score.
 *
 * The score is a transparent, capped sum over the findings produced by the
 * default rules. It reflects only what was observed on this machine during
 * this scan; it is explicitly not a verdict or a statistically calibrated
 * probability. Every point comes with the factor that produced it.
 */
export type RiskFactorDefinition = {
  label: string;
  points: number;
  cap: number;
};

export const RISK_RULE_WEIGHTS: Record<string, RiskFactorDefinition> = {
  [MASQUERADING_RULE_ID]: {
    label: "System binary name running from an unexpected location",
    points: 25,
    cap: 50,
  },
  [UNSIGNED_USER_LOCATION_RULE_ID]: {
    label: "Unsigned or invalidly signed executable in a user-writable location",
    points: 12,
    cap: 48,
  },
  [TEMP_LOCATION_RULE_ID]: {
    label: "Executable running from a temporary directory",
    points: 4,
    cap: 12,
  },
};

export const RISK_BANDS = ["LOW", "MODERATE", "ELEVATED", "HIGH"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export type RiskFactor = {
  id: string;
  label: string;
  occurrences: number;
  points: number;
};

export type IntegrityRisk = {
  basis: "heuristic";
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
};

function bandFor(score: number): RiskBand {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "ELEVATED";
  if (score >= 15) return "MODERATE";
  return "LOW";
}

export function computeIntegrityRisk(findings: readonly Finding[]): IntegrityRisk {
  const occurrences = new Map<string, number>();
  for (const finding of findings) {
    if (!(finding.ruleId in RISK_RULE_WEIGHTS)) {
      continue;
    }
    occurrences.set(finding.ruleId, (occurrences.get(finding.ruleId) ?? 0) + 1);
  }

  const factors: RiskFactor[] = [];
  let score = 0;
  for (const [id, definition] of Object.entries(RISK_RULE_WEIGHTS)) {
    const count = occurrences.get(id) ?? 0;
    if (count === 0) {
      continue;
    }
    const points = Math.min(count * definition.points, definition.cap);
    score += points;
    factors.push({ id, label: definition.label, occurrences: count, points });
  }

  const capped = Math.min(100, score);
  return { basis: "heuristic", score: capped, band: bandFor(capped), factors };
}
