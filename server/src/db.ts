import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('msi_app_player', 'bluestacks_5', 'google_play_games_beta')),
  game_target TEXT CHECK (game_target IS NULL OR game_target IN ('free_fire')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
  progress REAL,
  scanner_version TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  scan_job_id TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('file_integrity', 'process_metadata', 'configuration', 'installation', 'network_indicator', 'user_evidence', 'unknown')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('VERIFIED', 'MODIFIED', 'SUSPICIOUS', 'UNKNOWN', 'CLEAN')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  file_path TEXT,
  file_size_bytes INTEGER,
  file_modified_at TEXT,
  expected_sha256 TEXT,
  observed_sha256 TEXT,
  confidence REAL,
  limitations TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  scan_job_id TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  prompt_version TEXT,
  input_summary TEXT,
  output_text TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_findings_scan_job_id ON findings(scan_job_id);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_scan_job_id ON ai_analyses(scan_job_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_created_at ON scan_jobs(created_at);
`;

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(SCHEMA);
  return db;
}
