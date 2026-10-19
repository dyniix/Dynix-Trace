import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileSearch,
  Fingerprint,
  FolderTree,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { BRAND, BRAND_SUB, CONSOLE, EVIDENCE } from "@/data";
import {
  createScannerClient,
  isTerminalStatus,
  ScannerApiError,
  type RiskBand,
  type ScanJob,
  type ScanReport,
  type ScannerClient,
} from "@/lib/scanner-api";
import { useScanPolling } from "@/lib/use-scan-polling";
import {
  formatDuration,
  formatTimestamp,
  scanStagePosition,
  scanStageTotal,
} from "@/lib/scan-format";
import { Monogram, MonogramDefs } from "@/components/ui/monogram";
import ScanDropdown from "@/components/ui/scan-dropdown";
import EvidenceTable from "@/components/console/evidence-table";
import FindingsList from "@/components/console/findings-list";
import { ScanStatusBadge } from "@/components/console/scan-status";

const defaultClient = createScannerClient();
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const RING_RADIUS = 66;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const BAND_STYLES: Record<RiskBand, { text: string; chip: string; bar: string; ring: string }> = {
  LOW: {
    text: "text-emerald-300",
    chip: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100/90",
    bar: "bg-emerald-400/70",
    ring: "#34d399",
  },
  MODERATE: {
    text: "text-amber-300",
    chip: "border-amber-300/30 bg-amber-400/10 text-amber-100/90",
    bar: "bg-amber-400/70",
    ring: "#fbbf24",
  },
  ELEVATED: {
    text: "text-orange-300",
    chip: "border-orange-300/35 bg-orange-400/10 text-orange-100/90",
    bar: "bg-orange-400/70",
    ring: "#fb923c",
  },
  HIGH: {
    text: "text-red-300",
    chip: "border-red-400/35 bg-red-500/10 text-red-200/90",
    bar: "bg-red-400/70",
    ring: "#f87171",
  },
};

function bandLabel(band: RiskBand): string {
  return band.charAt(0) + band.slice(1).toLowerCase();
}

function messageOf(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}

function isNotFound(error: unknown): boolean {
  return error instanceof ScannerApiError && (error.code === "SCAN_NOT_FOUND" || error.status === 404);
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`glass-inset rounded-2xl p-5 ${className}`}>{children}</section>;
}

function PanelHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
        {children}
      </h2>
      {aside}
    </div>
  );
}

function StatRow({ label, value, tone = "text-white/80" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate text-[10.5px] text-white/45">{label}</span>
      <span className={`font-mono text-[11px] tabular-nums ${value === 0 ? "text-white/30" : tone}`}>
        {value}
      </span>
    </div>
  );
}

function Tile({
  icon,
  label,
  children,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-xl border border-white/[0.065] bg-white/[0.018] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-cyan-300/20 bg-cyan-400/[0.06] text-cyan-100/75">
          {icon}
        </span>
        <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/45">
          {label}
        </p>
      </div>
      <div className="mt-2.5 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MiniBar({
  segments,
  className = "",
}: {
  segments: { value: number; className: string }[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div aria-hidden className={`flex h-1.5 overflow-hidden rounded-full bg-white/[0.05] ${className}`}>
      {total > 0 &&
        segments
          .filter((segment) => segment.value > 0)
          .map((segment, index) => (
            <span
              key={index}
              className={`h-full ${segment.className}`}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
    </div>
  );
}

function JobNotices({ job }: { job: ScanJob }) {
  if (job.error === null && job.warnings.length === 0 && job.limitations.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {job.error !== null && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/[0.08] px-3.5 py-2.5 text-[12px] leading-5 text-red-200/90">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
            {CONSOLE.failureLabel}: {job.error.code}
          </span>
          <p className="mt-1 text-white/70">{job.error.message}</p>
        </div>
      )}
      {job.warnings.length > 0 && (
        <div className="rounded-lg border border-orange-300/25 bg-orange-400/[0.06] px-3.5 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-orange-100/85">
            {CONSOLE.warningsLabel}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {job.warnings.map((warning) => (
              <li key={warning.code} className="text-[12px] leading-5 text-white/70">
                <span className="font-mono text-[10.5px] text-orange-100/75">{warning.code}</span>
                {" · "}
                {warning.message}
                {warning.occurrences > 1 ? ` (×${warning.occurrences})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {job.limitations.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
            {CONSOLE.limitationsLabel}
          </p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
            {job.limitations.map((limitation) => (
              <li key={limitation} className="text-[12px] leading-5 text-white/60">
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RiskCard({ report }: { report: ScanReport }) {
  const style = BAND_STYLES[report.risk.band];
  const maxPoints = Math.max(1, ...report.risk.factors.map((factor) => factor.points));
  const dash = (Math.min(100, Math.max(0, report.risk.score)) / 100) * RING_CIRCUMFERENCE;

  return (
    <Panel className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
          {EVIDENCE.riskLabel}
        </h2>
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] ${style.chip}`}>
          {bandLabel(report.risk.band)}
        </span>
      </div>

      <div className="relative mx-auto my-2.5 grid place-items-center">
        <svg aria-hidden viewBox="0 0 160 160" className="size-[9.5rem] -rotate-90">
          <circle cx="80" cy="80" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
          {report.risk.score > 0 && (
            <circle
              cx="80"
              cy="80"
              r={RING_RADIUS}
              fill="none"
              stroke={style.ring}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
              style={{ filter: `drop-shadow(0 0 10px ${style.ring}66)` }}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <p
            data-testid="evidence-risk-score"
            className={`font-mono text-[2.6rem] leading-none font-semibold tabular-nums ${style.text}`}
          >
            {report.risk.score}
            <span className="ml-0.5 text-lg font-medium text-white/45">%</span>
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-5 text-white/45">{EVIDENCE.riskBasis}</p>

      <div className="flex flex-col gap-3 pt-4">
        {report.risk.factors.length === 0 ? (
          <p className="text-[11.5px] text-white/40">{EVIDENCE.noFactors}</p>
        ) : (
          report.risk.factors.map((factor) => (
            <div key={factor.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-[11.5px] leading-4 text-white/70">{factor.label}</span>
                <span className="font-mono text-[10px] tabular-nums text-white/35">
                  {EVIDENCE.factorOccurrences(factor.occurrences)}
                  <span className="ml-1.5 text-white/65">{EVIDENCE.factorPoints(factor.points)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  aria-hidden
                  className={`h-full rounded-full ${style.bar}`}
                  style={{ width: `${Math.round((factor.points / maxPoints) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto pt-5">
        <div className="relative">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <span aria-hidden className="h-full flex-[15] bg-emerald-400/55" />
            <span aria-hidden className="h-full flex-[25] bg-amber-400/55" />
            <span aria-hidden className="h-full flex-[30] bg-orange-400/55" />
            <span aria-hidden className="h-full flex-[30] bg-red-400/55" />
          </div>
          <span
            aria-hidden
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.75)]"
            style={{ left: `${Math.min(100, Math.max(0, report.risk.score))}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.1em] text-white/30">
          <span>{bandLabel("LOW")}</span>
          <span>{bandLabel("MODERATE")}</span>
          <span>{bandLabel("ELEVATED")}</span>
          <span>{bandLabel("HIGH")}</span>
        </div>
      </div>
    </Panel>
  );
}

function StatsCard({ report }: { report: ScanReport }) {
  const stats = report.stats;
  const totalRecords = Math.max(stats.evidenceRecords, 1);
  const signaturesChecked =
    stats.signatures.valid +
    stats.signatures.unsigned +
    stats.signatures.invalid +
    stats.signatures.unknown +
    stats.signatures.unavailable;
  const signatureCoverage = Math.round((signaturesChecked / totalRecords) * 100);
  const hashesTotal = stats.hashes.present + stats.hashes.missing;
  const hashCoverage = hashesTotal > 0 ? Math.round((stats.hashes.present / hashesTotal) * 100) : 0;

  return (
    <section className="glass-inset rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
          {EVIDENCE.statsLabel}
        </h2>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/30">
          {report.risk.basis}
        </span>
      </div>

      <div className="grid auto-rows-fr gap-2.5 sm:grid-cols-2">
        <Tile icon={<FileSearch aria-hidden className="size-3.5" />} label={EVIDENCE.statEvidence}>
          <p className="font-mono text-2xl leading-none tabular-nums text-white/85">
            {stats.evidenceRecords}
          </p>
          <MiniBar
            className="mt-2.5"
            segments={[
              { value: stats.evidenceRecords, className: "bg-cyan-400/60" },
              { value: Math.max(0, report.job.processCount - stats.evidenceRecords), className: "bg-white/[0.08]" },
            ]}
          />
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
            {report.job.processCount} {EVIDENCE.metaProcesses.toLowerCase()}
          </p>
          {stats.evidenceTruncated && (
            <p className="mt-1 text-[10.5px] leading-4 text-amber-100/75">{EVIDENCE.evidenceTruncated}</p>
          )}
        </Tile>

        <Tile icon={<ShieldCheck aria-hidden className="size-3.5" />} label={EVIDENCE.statSignatures}>
          <MiniBar
            segments={[
              { value: stats.signatures.valid, className: "bg-emerald-400/70" },
              { value: stats.signatures.unsigned, className: "bg-sky-400/60" },
              { value: stats.signatures.invalid, className: "bg-red-400/70" },
              { value: stats.signatures.unknown, className: "bg-amber-300/60" },
              { value: stats.signatures.unavailable, className: "bg-white/20" },
              { value: stats.signatures.notChecked, className: "bg-white/[0.08]" },
            ]}
          />
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label={EVIDENCE.sigValid} value={stats.signatures.valid} tone="text-emerald-300" />
            <StatRow label={EVIDENCE.sigUnsigned} value={stats.signatures.unsigned} tone="text-white/75" />
            <StatRow label={EVIDENCE.sigInvalid} value={stats.signatures.invalid} tone="text-red-300" />
            <StatRow label={EVIDENCE.sigUnknown} value={stats.signatures.unknown} />
            <StatRow label={EVIDENCE.sigUnavailable} value={stats.signatures.unavailable} />
            <StatRow label={EVIDENCE.sigNotChecked} value={stats.signatures.notChecked} />
          </div>
          <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/30">
            {signatureCoverage}% checked
          </p>
        </Tile>

        <Tile icon={<Fingerprint aria-hidden className="size-3.5" />} label={EVIDENCE.statHashes}>
          <MiniBar
            segments={[
              { value: stats.hashes.present, className: "bg-emerald-400/70" },
              { value: stats.hashes.missing, className: "bg-amber-400/60" },
            ]}
          />
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label={EVIDENCE.hashPresent} value={stats.hashes.present} tone="text-emerald-300" />
            <StatRow label={EVIDENCE.hashMissing} value={stats.hashes.missing} tone="text-amber-300" />
          </div>
          <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/30">
            {hashCoverage}% hashed
          </p>
        </Tile>

        <Tile icon={<FolderTree aria-hidden className="size-3.5" />} label={EVIDENCE.statPaths}>
          <MiniBar
            segments={[
              { value: stats.paths.system, className: "bg-cyan-400/60" },
              { value: stats.paths.userWritable, className: "bg-amber-400/60" },
              { value: stats.paths.temp, className: "bg-orange-400/60" },
              { value: stats.paths.other, className: "bg-white/25" },
              { value: stats.paths.withoutPath, className: "bg-white/[0.08]" },
            ]}
          />
          <div className="mt-2.5 flex flex-col gap-y-1">
            <StatRow label={EVIDENCE.pathSystem} value={stats.paths.system} />
            <StatRow label={EVIDENCE.pathUser} value={stats.paths.userWritable} />
            <StatRow label={EVIDENCE.pathTemp} value={stats.paths.temp} />
            <StatRow label={EVIDENCE.pathOther} value={stats.paths.other} />
            {stats.paths.withoutPath > 0 && (
              <StatRow label={EVIDENCE.pathUnknown} value={stats.paths.withoutPath} />
            )}
          </div>
        </Tile>
      </div>
    </section>
  );
}

function MetaCard({ job, generatedAt }: { job: ScanJob; generatedAt: string }) {
  const entries = [
    { label: EVIDENCE.metaStarted, value: formatTimestamp(job.startedAt) },
    { label: EVIDENCE.metaDuration, value: formatDuration(job.startedAt, job.completedAt) },
    { label: EVIDENCE.metaProcesses, value: String(job.processCount) },
    { label: EVIDENCE.metaFindings, value: String(job.findingsCount) },
    { label: EVIDENCE.generatedLabel, value: formatTimestamp(generatedAt) },
  ];

  return (
    <section className="glass-inset rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
          {EVIDENCE.metaLabel}
        </h2>
        <span
          className="max-w-[55%] truncate font-mono text-[10.5px] text-cyan-100/60"
          title={job.scanId}
        >
          {job.scanId}
        </span>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {entries.map((entry) => (
          <div key={entry.label} className="min-w-0">
            <dt className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-white/30">
              {entry.label}
            </dt>
            <dd className="mt-0.5 truncate font-mono text-[10.5px] text-white/65" title={entry.value}>
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ExportButtons({ report, scanId }: { report: ScanReport | null; scanId: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const resetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    };
  }, []);

  const payload = useMemo(() => (report === null ? null : JSON.stringify(report, null, 2)), [report]);

  const download = useCallback(() => {
    if (payload === null) return;
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dynix-trace-report-${scanId}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [payload, scanId]);

  const copy = useCallback(async () => {
    if (payload === null) return;
    try {
      if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(payload);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    resetRef.current = window.setTimeout(() => setCopied("idle"), 2200);
  }, [payload]);

  const itemClass =
    "inline-flex h-7.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[10.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60";

  return (
    <div className="glass-inset flex shrink-0 items-center gap-0.5 rounded-xl p-0.5">
      <button
        type="button"
        data-testid="evidence-export-json"
        onClick={download}
        disabled={report === null}
        className={`${itemClass} text-white/70 hover:bg-white/[0.08] hover:text-white`}
      >
        <Download aria-hidden className="size-3.5" />
        {EVIDENCE.exportJson}
      </button>
      <span aria-hidden className="h-4 w-px bg-white/10" />
      <button
        type="button"
        data-testid="evidence-copy-json"
        onClick={() => void copy()}
        disabled={report === null}
        className={`${itemClass} ${
          copied === "copied"
            ? "bg-emerald-400/10 text-emerald-200"
            : copied === "failed"
              ? "text-red-200/85 hover:bg-white/[0.08]"
              : "text-white/70 hover:bg-white/[0.08] hover:text-white"
        }`}
      >
        {copied === "copied" ? (
          <Check aria-hidden className="size-3.5 text-emerald-300" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
        {copied === "copied" ? EVIDENCE.copied : copied === "failed" ? EVIDENCE.copyFailed : EVIDENCE.exportCopy}
      </button>
    </div>
  );
}

export type EvidenceViewProps = {
  scanId: string | null;
  client?: ScannerClient;
  pollIntervalMs?: number;
};

export default function EvidenceView({ scanId, client = defaultClient, pollIntervalMs }: EvidenceViewProps) {
  const [history, setHistory] = useState<ScanJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyToken, setHistoryToken] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(scanId);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [reportLoading, setReportLoading] = useState(scanId !== null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const refreshedForRef = useRef<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  const activeScanId = selectedId;

  useEffect(() => {
    setSelectedId(scanId);
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    client
      .listScans(50)
      .then((result) => {
        if (cancelled) return;
        setHistory(result);
        setHistoryLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setHistoryError(messageOf(caught));
        setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, historyToken]);

  // Landing on #evidence opens the newest recorded trace instead of an empty
  // index — the browser should always have evidence in view.
  useEffect(() => {
    if (scanId !== null || selectedId !== null) return;
    const latest = history[0];
    if (latest === undefined) return;
    setSelectedId(latest.scanId);
    window.history.replaceState(null, "", `#evidence/${encodeURIComponent(latest.scanId)}`);
  }, [scanId, selectedId, history]);

  const selectScan = useCallback((nextId: string) => {
    setSelectedId(nextId);
    const nextHash = `#evidence/${encodeURIComponent(nextId)}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, []);

  const polling = useScanPolling(
    client,
    activeScanId,
    pollIntervalMs !== undefined ? { pollIntervalMs } : {},
  );

  useEffect(() => {
    if (activeScanId === null) {
      setReport(null);
      setReportLoading(false);
      setReportError(null);
      setNotFound(false);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setNotFound(false);
    client
      .getScanReport(activeScanId)
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setReportLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setReport(null);
        if (isNotFound(caught)) {
          setNotFound(true);
        } else {
          setReportError(messageOf(caught));
        }
        setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, activeScanId, reloadToken]);

  // While the scan runs, the report is a partial snapshot: refetch once the
  // job reaches a terminal state so the numbers settle.
  const reportStatus = report?.job.status ?? null;
  useEffect(() => {
    if (activeScanId === null) {
      refreshedForRef.current = null;
      return;
    }
    const job = polling.job;
    if (job === null || !isTerminalStatus(job.status)) return;
    if (reportStatus !== null && isTerminalStatus(reportStatus)) return;
    if (refreshedForRef.current === activeScanId) return;
    refreshedForRef.current = activeScanId;
    setReloadToken((token) => token + 1);
  }, [polling.job, activeScanId, reportStatus]);

  const displayJob = report?.job ?? polling.job;
  const running = displayJob !== null && !isTerminalStatus(displayJob.status);

  const retryReport = useCallback(() => {
    setReloadToken((token) => token + 1);
    polling.refresh();
  }, [polling]);

  const retryHistory = useCallback(() => setHistoryToken((token) => token + 1), []);

  const loadingBlock = (
    <div
      data-testid="evidence-loading"
      className="flex items-center gap-2.5 px-1 py-16 text-[12px] text-white/50"
      role="status"
    >
      <LoaderCircle aria-hidden className="size-4 animate-spin text-cyan-200/80" />
      {EVIDENCE.loading}
    </div>
  );

  const retryButton = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 text-[11px] text-white/75 transition hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
    >
      <RefreshCw aria-hidden className="size-3.5" />
      {EVIDENCE.retry}
    </button>
  );

  let content: ReactNode;

  if (activeScanId === null) {
    if (historyError !== null) {
      content = (
        <div className="flex flex-col items-start gap-3 px-1 py-16">
          <p className="text-[12px] text-red-200/90" role="alert">
            {EVIDENCE.listLoadFailed} <span className="text-white/45">{historyError}</span>
          </p>
          {retryButton(retryHistory)}
        </div>
      );
    } else if (historyLoading || history.length > 0) {
      content = loadingBlock;
    } else {
      content = (
        <div className="flex flex-col items-center gap-4 px-1 py-20 text-center">
          <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
            <FileSearch aria-hidden className="size-5 text-white/40" />
          </span>
          <p className="max-w-xs text-[12.5px] leading-5 text-white/50">{EVIDENCE.listEmpty}</p>
          <a
            href="#"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            {EVIDENCE.newScan}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </div>
      );
    }
  } else if (reportLoading) {
    content = loadingBlock;
  } else if (notFound) {
    content = (
      <div className="flex flex-col items-center gap-4 px-1 py-20 text-center">
        <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <AlertTriangle aria-hidden className="size-5 text-amber-300/80" />
        </span>
        <h2 className="text-lg font-semibold">{EVIDENCE.notFoundTitle}</h2>
        <p className="max-w-sm text-[12.5px] leading-5 text-white/50">{EVIDENCE.notFoundBody}</p>
        <a
          href="#evidence"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 text-[11px] text-white/75 transition hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          {EVIDENCE.listLabel}
        </a>
      </div>
    );
  } else if (reportError !== null) {
    content = (
      <div data-testid="evidence-error" className="flex flex-col items-start gap-3 px-1 py-16">
        <p className="text-[12px] text-red-200/90" role="alert">
          {EVIDENCE.loadFailed} <span className="text-white/45">{reportError}</span>
        </p>
        {retryButton(retryReport)}
      </div>
    );
  } else if (report === null) {
    content = loadingBlock;
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {running && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cyan-300/25 bg-cyan-400/[0.06] px-3.5 py-2.5 text-[12px] leading-5 text-cyan-100/90">
            <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1">{EVIDENCE.runningNote}</span>
            <a
              href="#console"
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 text-[11px] text-white/75 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              {EVIDENCE.runningCta}
            </a>
          </div>
        )}

        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,288px)_minmax(0,1fr)]">
          <RiskCard report={report} />
          <div className="flex min-w-0 flex-col gap-3.5">
            <StatsCard report={report} />
            {displayJob !== null && (
              <MetaCard job={displayJob} generatedAt={report.generatedAt} />
            )}
          </div>
        </div>

        {displayJob !== null && <JobNotices job={displayJob} />}

        <Panel>
          <PanelHeading
            aside={
              <span className="font-mono text-[10px] tabular-nums text-white/45">
                {report.findings.length}
              </span>
            }
          >
            {CONSOLE.findingsLabel}
          </PanelHeading>
          <FindingsList client={client} scanId={activeScanId} />
        </Panel>

        <Panel>
          <PanelHeading
            aside={
              <span className="font-mono text-[10px] tabular-nums text-white/45">
                {report.stats.evidenceRecords}
              </span>
            }
          >
            {CONSOLE.inventoryLabel}
          </PanelHeading>
          <EvidenceTable
            client={client}
            scanId={activeScanId}
            totalProcesses={displayJob?.processCount ?? report.job.processCount}
          />
        </Panel>
      </div>
    );
  }

  return (
    <section className="relative flex h-svh w-full flex-col overflow-hidden text-white">
      <MonogramDefs />

      <motion.header
        initial={{ opacity: 0, y: reduced ? 0 : -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.7, ease: EASE }}
        className="relative z-20 flex shrink-0 items-center justify-between gap-4 px-6 py-5 lg:px-10"
      >
        <a
          href="#"
          className="inline-flex items-center gap-2.5 rounded-xl text-[13px] font-medium text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {CONSOLE.back}
        </a>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
          <span className="grid size-8 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-400/5 backdrop-blur">
            <Monogram className="size-4.5" />
          </span>
          <span className="text-sm font-semibold tracking-[0.35em]">
            {BRAND} <span className="font-light text-white/55">{BRAND_SUB}</span>
          </span>
        </div>
        <a
          href="#console"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pr-3 pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 backdrop-blur transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          {EVIDENCE.back}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </motion.header>

      <motion.main
        initial={{ opacity: 0, y: reduced ? 0 : 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.1, ease: EASE }}
        className="relative z-10 mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pb-10 lg:px-10"
      >
        <div className="shrink-0 pb-4">
          <p className="prism-text font-mono text-[10px] font-semibold uppercase tracking-[0.3em]">
            {EVIDENCE.kicker}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{EVIDENCE.title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/55">{EVIDENCE.subtitle}</p>
        </div>

        <div
          data-testid="evidence-window"
          className="liquid-glass relative flex min-h-[240px] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[22px]"
        >
          <header className="glass-toolbar relative z-20 flex shrink-0 flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-x-3">
              <div className="flex shrink-0 items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/[0.07]">
                  <FileSearch aria-hidden className="size-3.5 text-cyan-100/80" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                  {EVIDENCE.browserLabel}
                </p>
              </div>
              <div className="min-w-0">
              <ScanDropdown
                scans={history}
                selectedScanId={activeScanId}
                onSelect={selectScan}
                loading={historyLoading}
                error={historyError}
                onRetry={retryHistory}
                label={EVIDENCE.pickerLabel}
                placeholder={EVIDENCE.pickerPlaceholder}
                emptyLabel={EVIDENCE.pickerEmpty}
                loadingLabel={EVIDENCE.pickerLoading}
                errorLabel={EVIDENCE.pickerUnavailable}
                refreshLabel={CONSOLE.refresh}
                testId="evidence-scan-picker"
              />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {activeScanId !== null && <ExportButtons report={report} scanId={activeScanId} />}
            </div>
          </header>

          <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            {content}
          </div>

          <footer className="glass-footer relative z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.07] px-4 py-3 sm:px-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
              {CONSOLE.scanIdLabel}:{" "}
              <span className="normal-case text-white/70" title={activeScanId ?? undefined}>
                {activeScanId ?? CONSOLE.noneNote}
              </span>
            </span>
            {displayJob !== null && <ScanStatusBadge status={displayJob.status} />}
            {displayJob !== null && isTerminalStatus(displayJob.status) && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                {displayJob.processCount} {CONSOLE.processCountLabel} · {displayJob.findingsCount}{" "}
                {CONSOLE.findingsCountLabel}
              </span>
            )}
            {displayJob !== null && displayJob.status === "RUNNING" && displayJob.progress !== null && (
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-100/70">
                <LoaderCircle aria-hidden className="size-3 animate-spin" />
                {CONSOLE.stageLabel} {scanStagePosition(displayJob.progress.stage)}/{scanStageTotal()}
              </span>
            )}
          </footer>
        </div>
      </motion.main>
    </section>
  );
}
