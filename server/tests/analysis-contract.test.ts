import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/errors.ts";
import {
  parseAiAnalysisResult,
  parseScanContext,
  type AIAnalysisResult,
  type ScanContext,
} from "../src/ai/analysis-contract.ts";

const fixtureScanContext: ScanContext = {
  scanId: "scan-fixture-0001",
  platform: "bluestacks_5",
  game: "free fire",
  checksCompleted: ["emulator install inventory", "game file hash comparison"],
  findings: [
    {
      findingId: "finding-fixture-0001",
      title: "Game config file differs from reference build",
      category: "configuration",
      severity: "low",
      status: "MODIFIED",
      observedFacts: ["Fixture config differs in one graphics key."],
      evidenceReferences: ["finding-fixture-0001#config-diff"],
    },
  ],
  limitations: ["Hash comparison relied on a single reference build."],
};

const fixtureValidAnalysis: AIAnalysisResult = {
  summary: "Fixture summary: one modified config file, no strong indication of interference.",
  findings: [
    {
      findingId: "finding-fixture-0001",
      assessment: "Fixture assessment: consistent with a legitimate graphics setting change.",
      confidence: 0.4,
      notes: "Fixture note.",
    },
  ],
  evidenceReferences: ["finding-fixture-0001#config-diff"],
  confidence: 0.35,
  alternativeExplanations: ["User-changed graphics settings."],
  limitations: ["Only one reference build was compared."],
  recommendedChecks: ["Compare against an additional clean reference build."],
};

test("a well-formed fixture scan context and AI analysis result pass validation", () => {
  const context = parseScanContext(fixtureScanContext);
  assert.equal(context.scanId, "scan-fixture-0001");
  assert.equal(context.findings[0].findingId, "finding-fixture-0001");

  const analysis = parseAiAnalysisResult(fixtureValidAnalysis);
  assert.equal(analysis.findings[0].findingId, "finding-fixture-0001");
  assert.equal(analysis.confidence, 0.35);
});

test("an AI analysis result with a missing summary is rejected with INVALID_AI_RESPONSE", () => {
  const fixtureMissingSummary = {
    findings: fixtureValidAnalysis.findings,
    evidenceReferences: fixtureValidAnalysis.evidenceReferences,
    confidence: fixtureValidAnalysis.confidence,
    alternativeExplanations: fixtureValidAnalysis.alternativeExplanations,
    limitations: fixtureValidAnalysis.limitations,
    recommendedChecks: fixtureValidAnalysis.recommendedChecks,
  };
  assert.throws(
    () => parseAiAnalysisResult(fixtureMissingSummary),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_AI_RESPONSE" &&
      Array.isArray(error.details),
  );
});

test("out-of-range or mistyped confidence values are rejected", () => {
  const fixtureOutOfRangeConfidence = { ...fixtureValidAnalysis, confidence: 1.5 };
  const fixtureMistypedConfidence = { ...fixtureValidAnalysis, confidence: "high" };
  assert.throws(
    () => parseAiAnalysisResult(fixtureOutOfRangeConfidence),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_AI_RESPONSE",
  );
  assert.throws(
    () => parseAiAnalysisResult(fixtureMistypedConfidence),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_AI_RESPONSE",
  );
});

test("scan contexts with malformed findings are rejected with INVALID_SCAN_CONTEXT", () => {
  assert.throws(
    () =>
      parseScanContext({
        ...fixtureScanContext,
        findings: [{ findingId: "finding-fixture-0002", title: "Missing required fields" }],
      }),
    (error: unknown) =>
      error instanceof AppError && error.code === "INVALID_SCAN_CONTEXT",
  );
});
