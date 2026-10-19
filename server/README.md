# DYNIX TRACE — Local Backend

Local-only backend foundation for DYNIX TRACE: scan-job storage and an
AI provider configuration service. It runs on your machine and binds to
loopback by default.

**What exists in this phase:** health endpoint, SQLite schema for scan jobs,
findings, and AI analysis records (with insert/list repositories ready for a
future scanner), AI provider configuration (save / read / test / reset) with
SSRF guards, a versioned investigator prompt with a loading service, typed
request/response contracts for future AI evidence analysis, scanner
architecture contracts + lifecycle + evidence normalization (Phase 2A
Part 1), a read-only Windows process inventory engine (Phase 2A Part 2), scan
orchestration with a background queue, SQLite persistence and the local
scanner API (Phase 2A Part 3), local-only admin protection on every admin
route, and the deterministic analysis layer (Phase 2A Part 4): a persisted
console event feed, three transparent finding rules, a capped heuristic risk
score, and a report endpoint with honest statistics.

**What does not exist yet:** AI-assisted evidence analysis. The scanner
capability endpoint reports the truth for this machine: on Windows a
`windows-native` collector is registered; elsewhere everything reports
unavailable. No scan data is fabricated — every scan result under
`/api/scanner/*` comes from a real collection run (or a clearly mocked
collector in tests).

## Requirements

- Node.js >= 23.6 (verified on v26.2.0). The server runs TypeScript directly
  via Node's built-in type stripping — no build step. `node:sqlite` is
  built in, so there are no native dependencies.
- No global installs.

## Install

```powershell
cd server
npm install
```

## Run (development)

```powershell
npm run dev     # node --watch src/index.ts
npm start       # single run
```

Defaults: `http://127.0.0.1:3001`. The frontend dev server expects this
address (`http://localhost:5175` / `http://127.0.0.1:5175` are the allowed
CORS origins).

## Environment variables

Copy `.env.example` to `.env` to customize. All values are optional.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep loopback-only. |
| `PORT` | `3001` | Listen port. |
| `CORS_ORIGINS` | `http://localhost:5175,http://127.0.0.1:5175` | Comma-separated browser origins. |
| `DATA_DIR` | `.data` (next to the server code) | Database + AI config storage. |
| `DYNIX_ALLOW_LOCAL_AI` | `false` | When `true`, AI provider base URLs may target loopback/private addresses for any provider (trusted local setups). |

## Storage layout

```
server/.data/
  dynix-trace.sqlite    scan jobs + findings + AI analysis records
                        (schema migrated on open)
  ai-config.json        provider config; contains the API key in plain text
```

`.data/` is gitignored. The API key is stored **server-side only** and is
never returned by any endpoint — the API exposes only `hasApiKey`.

## API

All endpoints are restricted to loopback clients (`requireLocalAdmin`
preHandler; other addresses receive `403 LOCAL_ONLY`). This is the seam where
future OAuth authorization middleware will plug in.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service, database, and AI-configured status. |
| GET | `/api/ai/providers` | Provider catalog (id, label, default base URL, key required, local-network allowed). |
| GET | `/api/ai/config` | Stored config metadata — `provider`, `baseUrl`, `model`, `hasApiKey`, `timeoutMs`, `maxRetries`, `organizationId`, `updatedAt`. Never the key. |
| PUT | `/api/ai/config` | Save config. Omit `apiKey` to keep the stored key for the same provider; send `""` to clear it. Optional `timeoutMs` (1000–60000), `maxRetries` (0–5), `organizationId`. |
| DELETE | `/api/ai/config` | Remove the stored config and key. |
| POST | `/api/ai/config/test` | Live connection test. With a model ID set, sends one minimal chat message (`/chat/completions`, Anthropic `/messages`, or Ollama `/api/chat`) and reports the real reply + round-trip; without a model it probes the model list. Honors `timeoutMs` / `maxRetries`; retries only transient network failures, never HTTP error statuses. |
| POST | `/api/ai/test` | Alias of `/api/ai/config/test` with the same body and response. |
| GET | `/api/scans` | Legacy emulator-era scan jobs table (still separate from scanner results). |
| GET | `/api/scans/:id` | One legacy scan job + its findings. |
| GET | `/api/scanner/capabilities` | What the scanner can honestly do on this machine (platform, collector provenance, feature availability, limitations). |
| POST | `/api/scanner/scans` | Start a scan. Body must be exactly `{}` — any command/path/filter field is rejected. Returns `202` with the new `scanId` (or `429 SCAN_QUEUE_FULL`, `503 SCANNER_UNAVAILABLE`). |
| GET | `/api/scanner/scans?limit=` | Recent scans, newest first (limit 1–100, default 20). |
| GET | `/api/scanner/scans/:scanId` | One scan job: status, stage progress, counts, warnings, limitations, safe error. |
| POST | `/api/scanner/scans/:scanId/cancel` | Cancel a queued or running scan (running scans are aborted). `409 INVALID_TRANSITION` if already finished, `404 SCAN_NOT_FOUND` if unknown. |
| GET | `/api/scanner/scans/:scanId/evidence?limit=&offset=` | Persisted process evidence for the scan (limit 1–200, default 50). |
| GET | `/api/scanner/scans/:scanId/findings` | Persisted findings for the scan, produced by the deterministic rules below. |
| GET | `/api/scanner/scans/:scanId/events?after=&limit=` | The scan's console event feed (limit 1–500, default 500; `after` is the last seen sequence number). Returns `{ events, count, nextAfter }` — on an empty batch `nextAfter` stays pinned to the requested `after`, so cursors never jump backwards. |
| GET | `/api/scanner/scans/:scanId/report` | The report page payload: `{ report }` with the job, findings, the deterministic heuristic risk score + factors, and evidence-only statistics (signature/hash coverage, path classes, `evidenceTruncated`). |

Errors use a consistent body: `{ "error": { "code", "message", "details?" } }`.
Fastify's own client errors keep their status (for example `415` with code
`FST_ERR_CTP_INVALID_MEDIA_TYPE` for an unsupported content type) instead of
being masked as a 500.

### Connectivity test result

`POST /api/ai/config/test` returns `200` with a result object — provider
failures are reported as data, not thrown:

```json
{
  "result": {
    "ok": false,
    "provider": "openai",
    "latencyMs": 630,
    "error": { "code": "INVALID_CREDENTIALS", "message": "Provider rejected the credentials (HTTP 401). Check the API key." }
  }
}
```

Error codes: `INVALID_CREDENTIALS`, `INSUFFICIENT_PERMISSIONS`,
`ENDPOINT_NOT_FOUND`, `MODEL_NOT_FOUND`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`,
`PROVIDER_ERROR`, `UNREACHABLE`, `MISSING_API_KEY`. Invalid input (bad URL,
blocked address, unknown provider) returns `400` before any network call.

Failed connection tests are classified from the HTTP status plus, when the
provider sends a JSON error body, its error message/type/code — only
recognizable keywords are inspected, the body itself is never stored,
returned or logged:

- `401` → `INVALID_CREDENTIALS`; `403` → `INSUFFICIENT_PERMISSIONS` when the
  body points at permissions, otherwise `INVALID_CREDENTIALS`.
- `404`/`400`/`422` naming a model (`model_not_found`, "does not exist",
  Ollama's "try pulling it first", Anthropic's `not_found_error` with a
  `model:` message) → `MODEL_NOT_FOUND` — not blamed on the base URL.
- `404` confirming a URL problem, or `405` → `ENDPOINT_NOT_FOUND` "check the
  base URL"; a `404` with no usable body hedges between base URL and model
  ID instead of claiming certainty.
- `429` → `RATE_LIMITED`; `5xx` → `PROVIDER_ERROR`; network failures and
  timeouts → `UNREACHABLE`.

### Rate-limit handling

When a provider answers `429`, the backend reads `Retry-After` (seconds or
HTTP-date) and falls back to `x-ratelimit-reset-tokens` /
`x-ratelimit-reset-requests` duration headers (for example `3.5s`). The
response body is inspected only to distinguish daily quota exhaustion
(messages mentioning per-day limits, TPD/RPD or quota) from temporary
request/token limits — nothing else from the body is stored or logged.

- Automatic waiting is capped at **60 seconds per AI operation**. A
  `Retry-After` within that window is honored, then the request is retried.
- If the wait would exceed the window or the configured retry limit, the
  operation stops and reports `RATE_LIMITED` with `retryAfterSeconds` and
  `status: "RATE_LIMIT_WAIT"` — nothing blocks indefinitely.
- Daily quota exhaustion stops immediately with `QUOTA_EXHAUSTED` and
  `status: "AI_TEMPORARILY_UNAVAILABLE"` (no point waiting for a daily reset).
- Without usable retry information, a conservative bounded backoff
  (2s, 4s, 8s, 16s) is used, still inside the 60-second budget.
- Only rate limits and transient network failures are retried; 401/403/400/
  404/422 and malformed responses are never retried. Rate-limit waits count
  against the configured `maxRetries` (0–5).
- Retry attempts are logged (`provider`, attempt, HTTP status, wait, total
  wait) through the request logger. API keys, authorization headers and
  response bodies are never logged.
- Concurrent duplicate connection tests with identical settings share one
  provider request (in-flight de-duplication).
- Result fields `status`, `retryAfterSeconds`, `attempts` and `totalWaitMs`
  are additive; existing clients keep working. The `AI_OPERATION_STATUSES`
  vocabulary (`ANALYSIS_RUNNING`, `RATE_LIMIT_WAIT`, `ANALYSIS_PENDING`,
  `AI_TEMPORARILY_UNAVAILABLE`, `ANALYSIS_COMPLETED`) is defined in
  `src/domain.ts` for the future analysis pipeline; the DB
  `ai_analyses.status` values are unchanged — a rate-limited analysis stays
  `pending` with `error_code` recording the reason, so completed scans and
  findings are never affected by AI availability.

Supported providers: `openai`, `anthropic`, `openrouter`, `groq`, `ollama`,
and `custom`. Groq uses its OpenAI-compatible endpoint
(`https://api.groq.com/openai/v1`) — set the model to a Groq model ID such as
`qwen/qwen3.8-27b` and paste the key from the config UI.

## Scanner architecture (Phase 2A — contracts + Windows engine)

Architecture, validated contracts, and lifecycle for the Windows process
inventory scanner (Part 1), plus the read-only collection engine itself
(Part 2). The engine is not wired into an orchestrator or API yet — that is
Part 3. Capability detection without a registered collector still honestly
reports everything as unavailable.

- `src/scanner/contracts.ts` — zod contracts: `ScanJob`,
  `ProcessEvidence`, `ExecutableEvidence`, `Finding`, progress stages, and
  structured warnings. Every evidence field carries a status: `OBSERVED`,
  `VERIFIED`, `INFERRED`, `UNKNOWN`, `UNAVAILABLE`, `ACCESS_DENIED`,
  `NOT_APPLICABLE`, `PROCESS_EXITED`. A value can only exist when the status
  can carry one, so a confident-looking value without a source is a schema
  error. Progress is **stage-based only** (`INITIALIZING`,
  `ENUMERATING_PROCESSES`, `COLLECTING_PROCESS_METADATA`,
  `INSPECTING_EXECUTABLES`, `PERSISTING_EVIDENCE`, `FINALIZING`) — there is
  no percentage field to fabricate.
- `src/scanner/lifecycle.ts` — `QUEUED → RUNNING →
  COMPLETED | COMPLETED_WITH_WARNINGS | FAILED | CANCELLED` with enforced
  transitions (`INVALID_TRANSITION`, 409). All four latter statuses are
  terminal. The existing SQLite `scan_jobs.status` uses lowercase values and
  lacks `COMPLETED_WITH_WARNINGS`; Part 3 owns that additive migration
  (`LEGACY_SCAN_STATUS_EQUIVALENT` documents the mapping).
- `src/scanner/ports.ts` — boundaries: capability provider, process
  inventory collector, executable metadata collector, finding rules,
  orchestrator, persistence. Collectors declare
  `provenance: "windows-native" | "mocked"`; mock-produced evidence can
  never be presented as real Windows data.
- `src/scanner/capabilities.ts` — honest capability reporting. With no
  engine registered: `processInventory.available = false` and a clear
  "not implemented yet" reason. A mocked collector is explicitly labelled.
- `src/scanner/normalize.ts` — pure normalization from raw collector
  records to `ProcessEvidence`: missing fields become `UNKNOWN` (never
  guessed), access issues are preserved, invalid values (bad hash, negative
  size, malformed timestamps) are discarded with warnings, signatures
  without a verification method are downgraded to `UNKNOWN`, warnings are
  aggregated by code, and evidence IDs are deterministic
  (`<scanId>:proc:<pid>`) for safe de-duplication.
- `src/scanner/engine-error.ts` — `ScannerEngineError` with explicit codes
  (`PS_UNAVAILABLE`, `PS_TIMEOUT`, `PS_FAILED`, `PROCESS_QUERY_FAILED`).
- `src/scanner/windows/` — the Phase 2A Part 2 engine (Windows only, no
  administrator rights required):
  - `powershell.ts` — PowerShell runner over `execFile` with fixed flags
    (`-NoProfile -NonInteractive -ExecutionPolicy Bypass`), UTF-8 output,
    timeout + abort support, bounded output (64 MB), resolved system
    PowerShell path. Script text is compile-time constant; dynamic values
    reach scripts only through environment variables, never interpolation.
  - `processes.ts` — the fixed `Win32_Process` CIM query (PID, parent PID,
    name, executable path, ISO-8601 UTC start time) and a tolerant parser.
    Missing executable paths become `ACCESS_DENIED` (or `NOT_APPLICABLE` for
    the kernel pseudo-processes), never guessed.
  - `collector.ts` — `ProcessInventoryCollector` with provenance
    `windows-native`, scanner version, and honest engine-error propagation.
  - `executable.ts` — file size/timestamps via `stat`, streaming SHA-256
    (node crypto, abort-aware), and Authenticode verification via
    `Get-AuthenticodeSignature` (target passed as `DYNIX_TRACE_SIGNATURE_TARGET`
    env var). Status mapping: `Valid→VALID`, `NotSigned→UNSIGNED`,
    `HashMismatch→INVALID`, everything else `→UNKNOWN`; when PowerShell is
    unavailable the result is `UNAVAILABLE` + `method: "none"`, never a fake
    verdict.
- Read-only by design: no shell execution of user input, no process memory,
  no file modification, no arbitrary file selection — `scanRequestSchema`
  rejects any command/path fields.

## Scan orchestration + local scanner API (Phase 2A Part 3)

- `src/scanner/persistence.ts` — SQLite implementation of the persistence
  port with **additive, namespaced tables**: `scanner_jobs`,
  `scan_process_evidence`, `scanner_findings`. The legacy `scan_jobs` /
  `findings` tables are never rebuilt or dropped (`CREATE ... IF NOT EXISTS`
  only). Writes are transactional; evidence and finding appends are
  idempotent by primary key; every job write re-validates the full job
  against the contract, so stored rows can never silently violate lifecycle
  invariants. Corrupted rows raise errors instead of being silently
  defaulted.
- `src/scanner/orchestrator.ts` — background scan runner:
  - In-memory FIFO queue with capacity limits:
    `DYNIX_MAX_CONCURRENT_SCANS` (1–8, default 1) and
    `DYNIX_MAX_QUEUED_SCANS` (0–100, default 5; `0` means only scans that
    can start immediately are accepted). Over capacity: `429 SCAN_QUEUE_FULL`.
  - Stage-based progress is persisted as the scan advances
    (`INITIALIZING → ENUMERATING_PROCESSES → COLLECTING_PROCESS_METADATA →
    INSPECTING_EXECUTABLES → PERSISTING_EVIDENCE → FINALIZING`).
  - Executable inspection is deduplicated per unique path, so shared
    binaries are hashed/verified once per scan.
  - Terminal status is honest: any warning → `COMPLETED_WITH_WARNINGS`, a
    clean inventory → `COMPLETED`, engine failures → `FAILED` with the engine
    error code, cancellation → `CANCELLED`. Unexpected engine errors are
    reported generically (no internal paths leak into scan errors).
  - Cancellation: queued scans are removed before they run; running scans are
    aborted through the collection AbortSignal. Cancel on a finished scan is
    `409 INVALID_TRANSITION`.
  - **Restart semantics:** the in-memory queue does not survive a backend
    restart and is never resumed silently; SQLite is authoritative. On every
    boot, jobs left `QUEUED`/`RUNNING` are failed with
    `SCAN_INTERRUPTED` (idempotent). Finished scans are untouched.
- Finding rules: the production registry ships three deterministic rules
  (see Part 4 below). Rules are injectable via the orchestrator for tests; a
  rule draft that violates the finding contract fails the scan instead of
  persisting a broken finding. Zero findings is still a valid, honest scan.
- Known characteristic: each unique executable path costs one PowerShell
  spawn for signature verification plus a streaming hash, so a full first
  scan of this machine takes minutes. It is a background job with stage
  progress, and results are persisted as the scan completes.

## Deterministic analysis + console feed (Phase 2A Part 4)

- `src/scanner/events.ts` — the console event contract (`command`, `info`,
  `success`, `warn`, `risk`, `error`) with store-assigned per-scan sequence
  numbers. The orchestrator emits every executed step in order (spawned
  collector, enumeration counts, metadata progress, rule hits, terminal
  line); high-severity findings become red `risk` events, medium findings
  become `warn`, failures end the feed with an `error` event, and a
  cancellation records an explicit warning — nothing is decorative.
- `src/scanner/analysis/rules.ts` — pure finding rules over validated
  evidence, each carrying a rule id, severity and evidence references:
  - **R1 masquerading** — a system binary name (e.g. `svchost.exe`,
    `lsass.exe`) running from outside its real system directory (high).
  - **R2 unsigned-in-place** — `UNSIGNED`/`INVALID` executables in
    user-writable or temp locations (high), stating the signature status and
    verification method in the finding.
  - **R3 temp binaries** — signed, unknown or unchecked executables in temp
    directories (medium), without double-reporting R2 hits.
- `src/scanner/analysis/risk.ts` — `basis: "heuristic"`: a transparent,
  capped weighted sum over rule hits (R1 25 pts, cap 50; R2 12 pts, cap 48;
  R3 4 pts, cap 12) banded `LOW` (<15), `MODERATE` (15–39), `ELEVATED`
  (40–69), `HIGH` (≥70). No AI, no randomness — the same evidence always
  scores the same, and every factor lists its rule, points and occurrences.
- `src/scanner/analysis/report.ts` — aggregates job, findings, risk and
  evidence-only statistics (signature coverage, hash present/missing, path
  classes incl. user-writable/temp) for `GET .../report`. Truncation is
  reported honestly via `evidenceTruncated` (25 000-record evidence window)
  instead of being hidden.

## Investigator prompt + AI analysis contract (future phase)

- `prompts/freefire-investigator.md` — versioned prompt (front-matter `id`,
  `version`, `updated`) for future Free Fire evidence analysis. It forbids
  inventing evidence, requires finding-ID references, separates facts from
  hypotheses, and forbids declaring cheating from a filename match, modified
  file, unsigned file, or Defender exclusion alone.
- `src/ai/prompts.ts` — prompt loader with explicit errors
  (`INVALID_PROMPT_ID`, `PROMPT_NOT_FOUND`, `PROMPT_INVALID`).
- `src/ai/analysis-contract.ts` — zod schemas + parsers for `ScanContext`
  and `AIAnalysisResult` with runtime validation
  (`INVALID_SCAN_CONTEXT` / `INVALID_AI_RESPONSE`). No analysis is executed
  yet because no scanner exists; automated tests use clearly labelled
  fixtures only.

## Security model (this phase)

- Binds to `127.0.0.1`; every admin route checks the client is loopback.
- API keys stay on the server in `.data/ai-config.json`; never in the
  frontend bundle, `localStorage`, or API responses.
- SSRF protection: `http`/`https` only, no embedded credentials; loopback,
  private, reserved, and link-local ranges are blocked (cloud metadata
  addresses `169.254.169.254` / `metadata.google.internal` are *always*
  blocked). Loopback/private targets are allowed only for the Ollama
  provider or when `DYNIX_ALLOW_LOCAL_AI=true`. Hostnames are re-resolved
  and re-checked at test time; redirects are rejected; 8 s timeout.
  Known limitation: a DNS-rebinding race between the check and the request
  is not fully mitigated at this phase.
- No authentication yet — any local process (or local browser page that can
  reach the port) can use the API. That is acceptable for a trusted local
  machine only; production will add OAuth on the same preHandler seam.

## Tests

```powershell
npm test        # node:test — 173 tests
npm run typecheck
```

Coverage: health + CORS, config save/read/reset, secret redaction (the key
never appears in a response), URL validation, SSRF blocks (loopback/private/
link-local/metadata), provider connection failures against a local mock
server (200/401/500/closed port), error classification from provider bodies
(model-not-found on 404/400/422, URL-confirming 404, ambiguous 404 hedging,
permission-aware 403, stable 401/429 handling), live chat-reply tests incl.
the Groq OpenAI-compatible path, rate-limit handling (Retry-After honored
and capped at 60s, reset-header fallback, daily-quota detection, bounded
backoff, retry limits, no-retry on auth errors, in-flight de-duplication,
key-free retry logs), scan-data preservation when AI fails, DB schema
round-trips (scan jobs, findings, AI analyses) + cascade + enum constraints,
prompt loading (+ traversal rejection), analysis-contract validation with
labelled fixtures, the frontend API client's error mapping, scanner
lifecycle transitions, scanner contract validation (no value without a
status, no fabricated percentage, honest signature semantics, no
command/path requests), and evidence normalization from mocked collectors
(inaccessible processes, invalid raw values, provenance separation,
deterministic evidence IDs). The Windows engine has unit tests against a
mocked PowerShell runner (tolerant query parsing, honest Authenticode
mapping, real-file SHA-256, missing-file access statuses, abort behaviour)
and real-Windows integration tests that collect this machine's live process
inventory, hash a real file, and verify a real system binary's signature
(integration tests skip automatically off Windows). Part 3 adds persistence
round-trips (additive schema, contract-validated writes, idempotent appends,
ordered pagination, corrupted-row errors), orchestrator behaviour (queue
capacity, cancellation of queued and running scans, warning-aware terminal
states, per-path executable dedupe, rule-driven findings, invalid-rule
failure, restart recovery with `SCAN_INTERRUPTED`), and scanner API tests
over HTTP (202 start, strict empty request body, validated query params,
404/409/415 handling, loopback-only access, restart recovery on a real
file-backed database). Part 4 adds the analysis layer (R1–R3 rule behaviour
including grouping and no-double-reporting, the capped risk score and bands,
report statistics from evidence only, event-feed ordering with red risk /
warning / error / cancellation events) and API coverage for the events
cursor (incl. the pinned empty-batch `nextAfter`) and the report endpoint.

## Structure

```
server/
  src/
    index.ts               entry — loads .env, builds app, listens, graceful shutdown
    app.ts                 Fastify instance, CORS, error handler, route registration
    env.ts                 environment parsing with defaults
    errors.ts              AppError + error body helper
    db.ts                  SQLite open + schema
    domain.ts              types/enums: scan jobs, findings, evidence refs
    repositories.ts        insert/read helpers for scan jobs + findings
    ai/
      adapters.ts          provider catalog + connectivity probes (incl. Groq)
      service.ts           config persistence + test orchestration + de-dup
      rate-limit.ts        Retry-After parsing + bounded retry decisions
      url-guard.ts         SSRF validation + DNS re-check
      prompts.ts           versioned prompt loading with explicit errors
      analysis-contract.ts ScanContext / AIAnalysisResult schemas + parsers
    auth/local-admin.ts    loopback-only preHandler (future OAuth seam)
    scanner/
      contracts.ts         ScanJob / ProcessEvidence / ExecutableEvidence / Finding
      lifecycle.ts         status vocabulary + enforced transitions
      ports.ts             collector / capability / findings / orchestrator boundaries
      capabilities.ts      honest availability reporting for this machine
      normalize.ts         raw collector output -> validated evidence
      engine-error.ts      ScannerEngineError with explicit engine codes
      events.ts            console event contract + store-assigned sequences
      persistence.ts       additive scanner tables + transactional port implementation
      orchestrator.ts      background queue, capacity, cancel, restart recovery
      analysis/
        rules.ts           deterministic finding rules R1-R3 over evidence
        risk.ts            capped heuristic risk score + bands
        report.ts          report aggregation + evidence-only statistics
      windows/
        powershell.ts      fixed-flag PS runner (timeout/abort/env-only values)
        processes.ts       Win32_Process query + tolerant parser
        collector.ts       Windows-native process inventory collector
        executable.ts      stat + streaming SHA-256 + Authenticode signature
    routes/                health.ts, ai-config.ts, scans.ts, scanner.ts
  prompts/
    freefire-investigator.md   versioned evidence-analysis prompt (v1)
  tests/                   node:test suites (mocked OS adapters in tests/support)
```
