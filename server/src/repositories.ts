import type { DatabaseSync } from "node:sqlite";
import type {
  AiAnalysis,
  AiAnalysisInsert,
  EvidenceRef,
  Finding,
  FindingInsert,
  ScanJob,
  ScanJobInsert,
} from "./domain.ts";

type ScanJobRow = {
  id: string;
  platform: string;
  game_target: string | null;
  status: string;
  progress: number | null;
  scanner_version: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type FindingRow = {
  id: string;
  scan_job_id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  evidence_refs: string;
  file_path: string | null;
  file_size_bytes: number | null;
  file_modified_at: string | null;
  expected_sha256: string | null;
  observed_sha256: string | null;
  confidence: number | null;
  limitations: string;
  created_at: string;
};

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toScanJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    platform: row.platform as ScanJob["platform"],
    gameTarget: row.game_target as ScanJob["gameTarget"],
    status: row.status as ScanJob["status"],
    progress: row.progress,
    scannerVersion: row.scanner_version,
    error:
      row.error_code !== null || row.error_message !== null
        ? { code: row.error_code ?? "UNKNOWN", message: row.error_message ?? "" }
        : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    scanJobId: row.scan_job_id,
    category: row.category as Finding["category"],
    severity: row.severity as Finding["severity"],
    status: row.status as Finding["status"],
    title: row.title,
    description: row.description,
    evidence: parseJsonArray<EvidenceRef>(row.evidence_refs),
    file:
      row.file_path !== null
        ? {
            path: row.file_path,
            sizeBytes: row.file_size_bytes,
            modifiedAt: row.file_modified_at,
            expectedSha256: row.expected_sha256,
            observedSha256: row.observed_sha256,
          }
        : null,
    confidence: row.confidence,
    limitations: parseJsonArray<string>(row.limitations),
    createdAt: row.created_at,
  };
}

export function insertScanJob(db: DatabaseSync, job: ScanJobInsert): ScanJob {
  const createdAt = job.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO scan_jobs (
      id, platform, game_target, status, progress, scanner_version,
      error_code, error_message, created_at, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.platform,
    job.gameTarget ?? null,
    job.status ?? "queued",
    job.progress ?? null,
    job.scannerVersion ?? null,
    job.error?.code ?? null,
    job.error?.message ?? null,
    createdAt,
    job.startedAt ?? null,
    job.completedAt ?? null,
  );

  const created = getScanJob(db, job.id);
  if (!created) {
    throw new Error(`Scan job "${job.id}" was inserted but could not be read back.`);
  }
  return created;
}

export function getScanJob(db: DatabaseSync, id: string): ScanJob | null {
  const row = db.prepare("SELECT * FROM scan_jobs WHERE id = ?").get(id) as
    | ScanJobRow
    | undefined;
  return row ? toScanJob(row) : null;
}

export function listScanJobs(db: DatabaseSync): ScanJob[] {
  const rows = db
    .prepare("SELECT * FROM scan_jobs ORDER BY created_at DESC")
    .all() as unknown as ScanJobRow[];
  return rows.map(toScanJob);
}

export function insertFinding(db: DatabaseSync, finding: FindingInsert): Finding {
  const createdAt = finding.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO findings (
      id, scan_job_id, category, severity, status, title, description,
      evidence_refs, file_path, file_size_bytes, file_modified_at,
      expected_sha256, observed_sha256, confidence, limitations, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    finding.id,
    finding.scanJobId,
    finding.category,
    finding.severity,
    finding.status,
    finding.title,
    finding.description,
    JSON.stringify(finding.evidence ?? []),
    finding.file?.path ?? null,
    finding.file?.sizeBytes ?? null,
    finding.file?.modifiedAt ?? null,
    finding.file?.expectedSha256 ?? null,
    finding.file?.observedSha256 ?? null,
    finding.confidence ?? null,
    JSON.stringify(finding.limitations ?? []),
    createdAt,
  );

  const row = db.prepare("SELECT * FROM findings WHERE id = ?").get(finding.id) as
    | FindingRow
    | undefined;
  if (!row) {
    throw new Error(`Finding "${finding.id}" was inserted but could not be read back.`);
  }
  return toFinding(row);
}

export function listFindingsByJob(db: DatabaseSync, scanJobId: string): Finding[] {
  const rows = db
    .prepare("SELECT * FROM findings WHERE scan_job_id = ? ORDER BY created_at ASC")
    .all(scanJobId) as unknown as FindingRow[];
  return rows.map(toFinding);
}

type AiAnalysisRow = {
  id: string;
  scan_job_id: string;
  finding_id: string | null;
  provider: string;
  model: string;
  status: string;
  prompt_version: string | null;
  input_summary: string | null;
  output_text: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

function toAiAnalysis(row: AiAnalysisRow): AiAnalysis {
  return {
    id: row.id,
    scanJobId: row.scan_job_id,
    findingId: row.finding_id,
    provider: row.provider,
    model: row.model,
    status: row.status as AiAnalysis["status"],
    promptVersion: row.prompt_version,
    inputSummary: row.input_summary,
    outputText: row.output_text,
    error:
      row.error_code !== null || row.error_message !== null
        ? { code: row.error_code ?? "UNKNOWN", message: row.error_message ?? "" }
        : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function insertAiAnalysis(db: DatabaseSync, analysis: AiAnalysisInsert): AiAnalysis {
  const createdAt = analysis.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_analyses (
      id, scan_job_id, finding_id, provider, model, status, prompt_version,
      input_summary, output_text, error_code, error_message, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    analysis.id,
    analysis.scanJobId,
    analysis.findingId ?? null,
    analysis.provider,
    analysis.model ?? "",
    analysis.status ?? "pending",
    analysis.promptVersion ?? null,
    analysis.inputSummary ?? null,
    analysis.outputText ?? null,
    analysis.error?.code ?? null,
    analysis.error?.message ?? null,
    createdAt,
    analysis.completedAt ?? null,
  );

  const row = db.prepare("SELECT * FROM ai_analyses WHERE id = ?").get(analysis.id) as
    | AiAnalysisRow
    | undefined;
  if (!row) {
    throw new Error(`AI analysis "${analysis.id}" was inserted but could not be read back.`);
  }
  return toAiAnalysis(row);
}

export function listAiAnalysesByJob(db: DatabaseSync, scanJobId: string): AiAnalysis[] {
  const rows = db
    .prepare("SELECT * FROM ai_analyses WHERE scan_job_id = ? ORDER BY created_at ASC")
    .all(scanJobId) as unknown as AiAnalysisRow[];
  return rows.map(toAiAnalysis);
}
