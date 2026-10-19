import { z } from "zod";
import { FINDING_SEVERITIES, FINDING_STATUSES, PLATFORMS } from "../domain.ts";
import { AppError } from "../errors.ts";

export const scanContextFindingSchema = z.object({
  findingId: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(64),
  severity: z.enum(FINDING_SEVERITIES),
  status: z.enum(FINDING_STATUSES),
  observedFacts: z.array(z.string().min(1).max(1000)),
  evidenceReferences: z.array(z.string().min(1).max(300)),
});

export const scanContextSchema = z.object({
  scanId: z.string().min(1).max(64),
  platform: z.enum(PLATFORMS),
  game: z.string().min(1).max(120),
  checksCompleted: z.array(z.string().min(1).max(300)),
  findings: z.array(scanContextFindingSchema),
  limitations: z.array(z.string().min(1).max(1000)),
});

export const aiAnalysisFindingSchema = z.object({
  findingId: z.string().min(1).max(64),
  assessment: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(2000).optional(),
});

export const aiAnalysisResultSchema = z.object({
  summary: z.string().min(1).max(6000),
  findings: z.array(aiAnalysisFindingSchema),
  evidenceReferences: z.array(z.string().min(1).max(300)),
  confidence: z.number().min(0).max(1),
  alternativeExplanations: z.array(z.string().min(1).max(2000)),
  limitations: z.array(z.string().min(1).max(2000)),
  recommendedChecks: z.array(z.string().min(1).max(1000)),
});

export type ScanContextFinding = z.infer<typeof scanContextFindingSchema>;
export type ScanContext = z.infer<typeof scanContextSchema>;
export type AIAnalysisFinding = z.infer<typeof aiAnalysisFindingSchema>;
export type AIAnalysisResult = z.infer<typeof aiAnalysisResultSchema>;

function issuesOf(error: z.ZodError): unknown {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function parseScanContext(input: unknown): ScanContext {
  const parsed = scanContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_SCAN_CONTEXT",
      400,
      "Scan context does not match the expected shape.",
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}

export function parseAiAnalysisResult(input: unknown): AIAnalysisResult {
  const parsed = aiAnalysisResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_AI_RESPONSE",
      502,
      "AI analysis response does not match the expected shape.",
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}
