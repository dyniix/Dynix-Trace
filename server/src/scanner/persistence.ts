import type { DatabaseSync } from "node:sqlite";
import {
  parseFindingContract,
  parseProcessEvidenceContract,
  scanJobSchema,
  SCAN_PROGRESS_STAGES,
  type Finding,
  type ProcessEvidence,
  type ScanJob,
} from "./contracts.ts";
import { scanEventInputSchema, scanEventSchema, type ScanEvent, type ScanEventInput } from "./events.ts";
import type { ScanPersistencePort } from "./ports.ts";

/**
 * Additive schema for the Phase 2A scanner. These tables are namespaced
 * separately from the legacy `scan_jobs` / `findings` tables so the existing
 * emulator-era constraints are never rebuilt or dropped. All statements are
 * CREATE ... IF NOT EXISTS: opening an existing database only adds what is
 * missing.
 */
export const SCANNER_SCHEMA = `
CREATE TABLE IF NOT EXISTS scanner_jobs (
  scan_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED')),
  platform TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  collector_provenance TEXT NOT NULL CHECK (collector_provenance IN ('windows-native', 'mocked')),
  progress_stage TEXT,
  checks_attempted INTEGER NOT NULL DEFAULT 0 CHECK (checks_attempted >= 0),
  checks_completed INTEGER NOT NULL DEFAULT 0 CHECK (checks_completed >= 0),
  process_count INTEGER NOT NULL DEFAULT 0 CHECK (process_count >= 0),
  findings_count INTEGER NOT NULL DEFAULT 0 CHECK (findings_count >= 0),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS scan_process_evidence (
  evidence_id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scanner_jobs(scan_id) ON DELETE CASCADE,
  process_id INTEGER NOT NULL CHECK (process_id >= 0),
  is_executable_evidence INTEGER NOT NULL DEFAULT 0 CHECK (is_executable_evidence IN (0, 1)),
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('windows-native', 'mocked'))
);

CREATE TABLE IF NOT EXISTS scanner_findings (
  finding_id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scanner_jobs(scan_id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_events (
  scan_id TEXT NOT NULL REFERENCES scanner_jobs(scan_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('command', 'info', 'success', 'warn', 'risk', 'error')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scan_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_scanner_jobs_status ON scanner_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scanner_jobs_created_at ON scanner_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_scan_process_evidence_scan ON scan_process_evidence(scan_id, process_id);
CREATE INDEX IF NOT EXISTS idx_scanner_findings_scan ON scanner_findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_scan ON scan_events(scan_id, seq);
`;

type ScannerJobRow = {
  scan_id: string;
  status: string;
  platform: string;
  scanner_version: string;
  collector_provenance: string;
  progress_stage: string | null;
  checks_attempted: number;
  checks_completed: number;
  process_count: number;
  findings_count: number;
  warnings_json: string;
  limitations_json: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type EvidenceRow = {
  evidence_id: string;
  scan_id: string;
  process_id: number;
  payload_json: string;
  source: string;
};

type FindingRow = {
  finding_id: string;
  scan_id: string;
  rule_id: string;
  category: string;
  severity: string;
  title: string;
  payload_json: string;
  created_at: string;
};

type ScanEventRow = {
  scan_id: string;
  seq: number;
  kind: string;
  text: string;
  created_at: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToJob(row: ScannerJobRow): ScanJob {
  const candidate = {
    scanId: row.scan_id,
    status: row.status,
    platform: row.platform,
    scannerVersion: row.scanner_version,
    collectorProvenance: row.collector_provenance,
    progress:
      row.progress_stage === null
        ? null
        : {
            stage: row.progress_stage,
            stageIndex: SCAN_PROGRESS_STAGES.indexOf(
              row.progress_stage as (typeof SCAN_PROGRESS_STAGES)[number],
            ),
            totalStages: SCAN_PROGRESS_STAGES.length,
          },
    checksAttempted: row.checks_attempted,
    checksCompleted: row.checks_completed,
    processCount: row.process_count,
    findingsCount: row.findings_count,
    warnings: parseJson<unknown[]>(row.warnings_json, []),
    limitations: parseJson<unknown[]>(row.limitations_json, []),
    error:
      row.error_code !== null || row.error_message !== null
        ? { code: row.error_code ?? "UNKNOWN", message: row.error_message ?? "" }
        : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
  const parsed = scanJobSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Stored scan job "${row.scan_id}" does not match the scanner contract (${first?.path.join(".") ?? "unknown"}).`,
    );
  }
  return parsed.data;
}

function rowToEvidence(row: EvidenceRow): ProcessEvidence {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Stored evidence "${row.evidence_id}" is not valid JSON.`);
  }
  return parseProcessEvidenceContract(payload);
}

function rowToFinding(row: FindingRow): Finding {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Stored finding "${row.finding_id}" is not valid JSON.`);
  }
  return parseFindingContract(payload);
}

function rowToScanEvent(row: ScanEventRow): ScanEvent {
  const parsed = scanEventSchema.safeParse({
    seq: row.seq,
    kind: row.kind,
    text: row.text,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Stored scan event "${row.scan_id}#${row.seq}" does not match the event contract (${first?.path.join(".") ?? "unknown"}).`,
    );
  }
  return parsed.data;
}

export function ensureScannerSchema(db: DatabaseSync): void {
  db.exec(SCANNER_SCHEMA);
}

function runInTransaction(db: DatabaseSync, work: () => void): void {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * SQLite implementation of the scanner persistence port. Writes are
 * transactional; evidence and finding appends are idempotent by primary key
 * (concurrent or repeated collection of the same process cannot create
 * duplicates). Every job write re-validates the full job against the
 * contract, so a stored job can never silently violate lifecycle invariants.
 */
export function createScannerPersistence(db: DatabaseSync): ScanPersistencePort {
  function writeJob(job: ScanJob): void {
    db.prepare(
      `INSERT INTO scanner_jobs (
        scan_id, status, platform, scanner_version, collector_provenance,
        progress_stage, checks_attempted, checks_completed, process_count,
        findings_count, warnings_json, limitations_json, error_code,
        error_message, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id) DO UPDATE SET
        status = excluded.status,
        platform = excluded.platform,
        scanner_version = excluded.scanner_version,
        collector_provenance = excluded.collector_provenance,
        progress_stage = excluded.progress_stage,
        checks_attempted = excluded.checks_attempted,
        checks_completed = excluded.checks_completed,
        process_count = excluded.process_count,
        findings_count = excluded.findings_count,
        warnings_json = excluded.warnings_json,
        limitations_json = excluded.limitations_json,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at`,
    ).run(
      job.scanId,
      job.status,
      job.platform,
      job.scannerVersion,
      job.collectorProvenance,
      job.progress?.stage ?? null,
      job.checksAttempted,
      job.checksCompleted,
      job.processCount,
      job.findingsCount,
      JSON.stringify(job.warnings),
      JSON.stringify(job.limitations),
      job.error?.code ?? null,
      job.error?.message ?? null,
      job.createdAt,
      job.startedAt,
      job.completedAt,
    );
  }

  return {
    async createJob(job) {
      const existing = db
        .prepare("SELECT scan_id FROM scanner_jobs WHERE scan_id = ?")
        .get(job.scanId);
      if (existing) {
        throw new Error(`Scan job "${job.scanId}" already exists.`);
      }
      writeJob(job);
    },

    async updateJob(scanId, patch) {
      const current = db
        .prepare("SELECT * FROM scanner_jobs WHERE scan_id = ?")
        .get(scanId) as ScannerJobRow | undefined;
      if (!current) {
        throw new Error(`Scan job "${scanId}" does not exist.`);
      }
      const merged = scanJobSchema.parse({ ...rowToJob(current), ...patch });
      writeJob(merged);
    },

    async getJob(scanId) {
      const row = db
        .prepare("SELECT * FROM scanner_jobs WHERE scan_id = ?")
        .get(scanId) as ScannerJobRow | undefined;
      return row ? rowToJob(row) : null;
    },

    async listJobs({ limit }) {
      const rows = db
        .prepare("SELECT * FROM scanner_jobs ORDER BY created_at DESC, scan_id DESC LIMIT ?")
        .all(limit) as unknown as ScannerJobRow[];
      return rows.map(rowToJob);
    },

    async appendProcessEvidence(scanId, processes) {
      if (processes.length === 0) {
        return;
      }
      const insert = db.prepare(
        `INSERT INTO scan_process_evidence (
          evidence_id, scan_id, process_id, is_executable_evidence, payload_json, source
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(evidence_id) DO NOTHING`,
      );
      runInTransaction(db, () => {
        for (const evidence of processes) {
          const validated = parseProcessEvidenceContract(evidence);
          insert.run(
            validated.evidenceId,
            scanId,
            validated.processId,
            validated.executable !== null ? 1 : 0,
            JSON.stringify(validated),
            validated.source,
          );
        }
      });
    },

    async appendFindings(scanId, findings) {
      if (findings.length === 0) {
        return;
      }
      const insert = db.prepare(
        `INSERT INTO scanner_findings (
          finding_id, scan_id, rule_id, category, severity, title, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(finding_id) DO NOTHING`,
      );
      runInTransaction(db, () => {
        for (const finding of findings) {
          const validated = parseFindingContract(finding);
          insert.run(
            validated.findingId,
            scanId,
            validated.ruleId,
            validated.category,
            validated.severity,
            validated.title,
            JSON.stringify(validated),
            validated.createdAt,
          );
        }
      });
    },

    async listProcessEvidence(scanId, { limit, offset }) {
      const rows = db
        .prepare(
          `SELECT * FROM scan_process_evidence
           WHERE scan_id = ?
           ORDER BY process_id ASC, evidence_id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(scanId, limit, offset) as unknown as EvidenceRow[];
      return rows.map(rowToEvidence);
    },

    async listFindings(scanId) {
      const rows = db
        .prepare("SELECT * FROM scanner_findings WHERE scan_id = ? ORDER BY created_at ASC, finding_id ASC")
        .all(scanId) as unknown as FindingRow[];
      return rows.map(rowToFinding);
    },

    async appendScanEvents(scanId, events: readonly ScanEventInput[]) {
      if (events.length === 0) {
        return;
      }
      // seq = MAX(seq) + 1 per scan, computed inside the same statement so
      // two appends can never claim the same sequence number.
      const insert = db.prepare(
        `INSERT INTO scan_events (scan_id, seq, kind, text, created_at)
         SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM scan_events WHERE scan_id = ?`,
      );
      runInTransaction(db, () => {
        for (const event of events) {
          const validated = scanEventInputSchema.parse(event);
          insert.run(scanId, validated.kind, validated.text, validated.createdAt, scanId);
        }
      });
    },

    async listScanEvents(scanId, { afterSeq, limit }) {
      const rows = db
        .prepare(
          `SELECT * FROM scan_events
           WHERE scan_id = ? AND seq > ?
           ORDER BY seq ASC
           LIMIT ?`,
        )
        .all(scanId, afterSeq, limit) as unknown as ScanEventRow[];
      return rows.map(rowToScanEvent);
    },
  };
}
