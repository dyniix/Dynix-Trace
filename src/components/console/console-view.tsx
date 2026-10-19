import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Info,
  LoaderCircle,
  RefreshCw,
  WifiOff,
  X,
} from "lucide-react";
import { BRAND, BRAND_SUB, CONSOLE, CTAS } from "@/data";
import {
  createScannerClient,
  isTerminalStatus,
  ScannerApiError,
  type ScanEvent,
  type ScanJob,
  type ScannerCapabilities,
  type ScannerClient,
} from "@/lib/scanner-api";
import { useScanPolling } from "@/lib/use-scan-polling";
import { useScanEvents } from "@/lib/use-scan-events";
import {
  formatDuration,
  scanStageLabel,
  scanStagePosition,
  scanStageTotal,
} from "@/lib/scan-format";
import { Monogram, MonogramDefs } from "@/components/ui/monogram";
import Terminal, { type TerminalLine } from "@/components/ui/terminal";
import ScanDropdown from "@/components/ui/scan-dropdown";
import { SceneBoostContext } from "@/components/ui/scene-background";
import { ScanStatusBadge } from "@/components/console/scan-status";

const defaultClient = createScannerClient();
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const REDIRECT_DELAY_MS = 1800;

type BootPhase = "loading" | "ready" | "offline" | "unavailable" | "invalid";

function messageOf(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}

/**
 * Backend feed line → terminal line. `risk` and `error` render red, `warn`
 * amber, `success` green — the 'red for high-probability evidence' rule.
 */
function eventToLine(event: ScanEvent): TerminalLine {
  switch (event.kind) {
    case "command":
      return { kind: "input", text: event.text };
    case "success":
      return { kind: "output", text: event.text, tone: "success" };
    case "warn":
      return { kind: "output", text: event.text, tone: "warning" };
    case "risk":
      return { kind: "output", text: event.text, tone: "error" };
    case "error":
      return { kind: "output", text: event.text, tone: "error" };
    case "info":
    default:
      return { kind: "output", text: event.text, tone: "info" };
  }
}

function Notice({
  tone,
  icon,
  children,
  action,
  testId,
}: {
  tone: "danger" | "warning";
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const palette =
    tone === "danger"
      ? "border-red-400/30 bg-red-500/[0.08] text-red-100/90"
      : "border-amber-300/25 bg-amber-400/[0.06] text-amber-100/90";
  return (
    <div
      role="alert"
      data-testid={testId}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[12px] leading-5 ${palette}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export type ConsoleViewProps = {
  client?: ScannerClient;
  pollIntervalMs?: number;
  eventPollIntervalMs?: number;
};

export default function ConsoleView({
  client = defaultClient,
  pollIntervalMs,
  eventPollIntervalMs,
}: ConsoleViewProps) {
  const [phase, setPhase] = useState<BootPhase>("loading");
  const [bootMessage, setBootMessage] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities | null>(null);
  const [history, setHistory] = useState<ScanJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ScanJob | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const bootRef = useRef(false);
  const terminalMarkerRef = useRef<string | null>(null);
  const armTimerRef = useRef<number | null>(null);
  const seenRunningRef = useRef(false);
  const reduced = useReducedMotion() ?? false;

  const polling = useScanPolling(
    client,
    activeScanId,
    pollIntervalMs !== undefined ? { pollIntervalMs } : {},
  );

  const scanActive =
    activeScanId !== null && (polling.job === null || !isTerminalStatus(polling.job.status));

  const viewedScanId = activeScanId !== null && scanActive ? activeScanId : selectedScanId;

  const events = useScanEvents(client, viewedScanId, {
    active: scanActive && viewedScanId === activeScanId,
    ...(eventPollIntervalMs !== undefined ? { pollIntervalMs: eventPollIntervalMs } : {}),
  });

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await client.listScans(50));
    } catch (error) {
      setHistoryError(messageOf(error));
    } finally {
      setHistoryLoading(false);
    }
  }, [client]);

  const bootstrap = useCallback(async () => {
    setPhase("loading");
    setBootMessage(null);
    try {
      const detected = await client.getCapabilities();
      setCapabilities(detected);
      const inventoryAvailable = detected.osSupported && detected.features.processInventory.available;
      setPhase(inventoryAvailable ? "ready" : "unavailable");
      if (inventoryAvailable) {
        void loadHistory();
      }
    } catch (error) {
      if (error instanceof ScannerApiError && error.code === "INVALID_RESPONSE") {
        setPhase("invalid");
      } else {
        setPhase("offline");
      }
      setBootMessage(messageOf(error));
    }
  }, [client, loadHistory]);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void bootstrap();
  }, [bootstrap]);

  // Refresh the picker list whenever a scan reaches a terminal state.
  useEffect(() => {
    const job = polling.job;
    if (job === null || !isTerminalStatus(job.status)) return;
    const marker = `${job.scanId}:${job.status}`;
    if (terminalMarkerRef.current !== marker) {
      terminalMarkerRef.current = marker;
      void loadHistory();
    }
  }, [polling.job, loadHistory]);

  // Console is a viewer: the newest recorded trace opens automatically.
  // A scan that is still running is promoted to the live feed.
  useEffect(() => {
    if (activeScanId !== null || selectedScanId !== null) return;
    const latest = history[0];
    if (latest === undefined) return;
    setSelectedScanId(latest.scanId);
    if (!isTerminalStatus(latest.status)) {
      seenRunningRef.current = true;
      setActiveScanId(latest.scanId);
    }
  }, [history, activeScanId, selectedScanId]);

  // History selection: fetch the job once (only when it is not the live one).
  useEffect(() => {
    if (selectedScanId === null || selectedScanId === activeScanId) {
      setSelectedJob(null);
      return;
    }
    let cancelled = false;
    client
      .getScan(selectedScanId)
      .then((job) => {
        if (!cancelled) setSelectedJob(job);
      })
      .catch(() => {
        if (!cancelled) setSelectedJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedScanId, activeScanId]);

  // Auto-visit the report once a scan that was seen running completes.
  useEffect(() => {
    const job = polling.job;
    if (job === null || activeScanId === null || job.scanId !== activeScanId) return;
    if (!isTerminalStatus(job.status)) {
      seenRunningRef.current = true;
      return;
    }
    const completed = job.status === "COMPLETED" || job.status === "COMPLETED_WITH_WARNINGS";
    if (!seenRunningRef.current || !completed) return;
    setRedirecting(true);
    const timer = window.setTimeout(() => {
      window.location.hash = `#evidence/${encodeURIComponent(job.scanId)}`;
    }, REDIRECT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setRedirecting(false);
    };
  }, [polling.job, activeScanId]);

  useEffect(() => {
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  // Accelerate the shared mesh while a scan is running.
  const setSceneBoost = useContext(SceneBoostContext);
  useEffect(() => {
    setSceneBoost(scanActive === true);
    return () => setSceneBoost(false);
  }, [scanActive, setSceneBoost]);

  const armCancel = useCallback(() => {
    if (cancelBusy || scanActive !== true || activeScanId === null) return;
    setCancelArmed(true);
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    armTimerRef.current = window.setTimeout(() => setCancelArmed(false), 4000);
  }, [cancelBusy, scanActive, activeScanId]);

  const confirmCancel = useCallback(async () => {
    if (activeScanId === null) return;
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    setCancelBusy(true);
    setCancelError(null);
    try {
      await client.cancelScan(activeScanId);
      setCancelArmed(false);
      polling.refresh();
    } catch (error) {
      if (error instanceof ScannerApiError && error.status === 409) {
        setCancelArmed(false);
        polling.refresh();
      } else {
        setCancelError(messageOf(error));
      }
    } finally {
      setCancelBusy(false);
    }
  }, [activeScanId, client, polling]);

  const viewedJob =
    selectedScanId !== null && selectedScanId === activeScanId ? polling.job : selectedJob;

  const viewedTerminal = viewedJob !== null && isTerminalStatus(viewedJob.status);
  const busy = scanActive;
  const noScans =
    phase === "ready" &&
    !historyLoading &&
    historyError === null &&
    history.length === 0 &&
    !scanActive;

  const feedLines: TerminalLine[] = useMemo(() => {
    if (events.events.length > 0) return events.events.map(eventToLine);
    let placeholder: string;
    if (scanActive) {
      placeholder = CONSOLE.terminalWaiting;
    } else if (viewedScanId === null) {
      placeholder = CONSOLE.terminalIdle;
    } else if (events.connection === "ok") {
      placeholder = CONSOLE.terminalEmpty;
    } else {
      placeholder = CONSOLE.terminalLoading;
    }
    return [{ kind: "output", text: placeholder, tone: "muted" }];
  }, [events.events, events.connection, scanActive, viewedScanId]);

  const phaseDot =
    phase === "ready"
      ? "bg-emerald-400"
      : phase === "loading"
        ? "animate-pulse bg-cyan-300"
        : "bg-red-400";
  const phaseLabel =
    phase === "ready"
      ? CONSOLE.statusOnline
      : phase === "loading"
        ? CONSOLE.statusConnecting
        : phase === "offline"
          ? CONSOLE.offlineTitle
          : CONSOLE.statusError;

  const featureEntries = capabilities === null
    ? []
    : ([
        { key: "processInventory", value: capabilities.features.processInventory },
        { key: "executableMetadata", value: capabilities.features.executableMetadata },
        { key: "sha256Hashing", value: capabilities.features.sha256Hashing },
        { key: "signatureVerification", value: capabilities.features.signatureVerification },
      ] as const);

  return (
    <section className="relative flex h-svh w-full flex-col overflow-hidden text-white">
      <MonogramDefs />

      <motion.header
        initial={{ opacity: 0, y: reduced ? 0 : -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.7, ease: EASE }}
        className="relative z-20 flex items-center justify-between gap-4 px-6 py-5 lg:px-10"
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
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pr-3 pl-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 backdrop-blur">
          <span aria-hidden className={`size-1.5 rounded-full ${phaseDot}`} />
          {phaseLabel}
        </span>
      </motion.header>

      {phase === "loading" && (
        <div className="relative z-10 flex flex-1 items-center justify-center" role="status">
          <div className="flex items-center gap-3 text-[13px] text-white/55">
            <LoaderCircle aria-hidden className="size-5 animate-spin text-cyan-200/80" />
            {CONSOLE.kicker.split("—")[0].trim()} · {CONSOLE.statusConnecting}
          </div>
        </div>
      )}

      {(phase === "offline" || phase === "invalid" || (phase === "unavailable" && capabilities !== null)) && (
        <div className="relative z-10 mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 pb-20 text-center">
          <span className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            {phase === "offline" ? (
              <WifiOff aria-hidden className="size-6 text-red-300/85" />
            ) : (
              <AlertTriangle aria-hidden className="size-6 text-amber-300/85" />
            )}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {phase === "offline"
              ? CONSOLE.offlineTitle
              : phase === "invalid"
                ? CONSOLE.invalidTitle
                : CONSOLE.unavailableTitle}
          </h1>
          <p className="max-w-md text-[13px] leading-6 text-white/55">
            {phase === "offline" ? CONSOLE.offlineBody : phase === "invalid" ? CONSOLE.invalidBody : CONSOLE.unavailableBody}
          </p>
          {bootMessage !== null && (
            <p className="max-w-md break-words font-mono text-[11px] text-white/40">{bootMessage}</p>
          )}
          {phase === "unavailable" && capabilities !== null && capabilities.limitations.length > 0 && (
            <ul className="max-w-md list-disc pl-4 text-left text-[12px] leading-5 text-white/45">
              {capabilities.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-2 inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-6 text-sm font-medium text-white/80 transition hover:border-white/30 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            <RefreshCw aria-hidden className="size-4" />
            {CONSOLE.retry}
          </button>
        </div>
      )}

      {phase === "ready" && (
        <motion.main
          initial={{ opacity: 0, y: reduced ? 0 : 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.1, ease: EASE }}
          className="relative z-10 mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pb-8 lg:px-10"
        >
          <div className="shrink-0 pb-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-100/60">
              {CONSOLE.kicker}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{CONSOLE.title}</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/55">{CONSOLE.subtitle}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 pb-3">
            <div className="min-w-0">
              <ScanDropdown
                scans={history}
                selectedScanId={viewedScanId}
                onSelect={(scanId) => setSelectedScanId(scanId)}
                loading={historyLoading}
                error={historyError}
                onRetry={() => void loadHistory()}
                disabled={scanActive}
                label={CONSOLE.pickerLabel}
                placeholder={CONSOLE.pickerPlaceholder}
                emptyLabel={CONSOLE.pickerEmpty}
                loadingLabel={CONSOLE.pickerLoading}
                errorLabel={CONSOLE.historyLoadFailed}
                refreshLabel={CONSOLE.refresh}
                testId="scan-picker"
              />
            </div>

            {scanActive && (
              <button
                type="button"
                onClick={cancelArmed ? () => void confirmCancel() : armCancel}
                disabled={cancelBusy}
                title={CONSOLE.cancelIdleNote}
                className={`ml-auto inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[11px] font-semibold uppercase tracking-[0.12em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
                  cancelArmed
                    ? "border-red-400/50 bg-red-500/15 text-red-100 hover:bg-red-500/25"
                    : "border-white/15 bg-white/[0.03] text-white/65 hover:border-white/30 hover:text-white"
                }`}
              >
                {cancelBusy ? (
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <X aria-hidden className="size-3.5" />
                )}
                {cancelBusy ? CONSOLE.cancelBusy : cancelArmed ? CONSOLE.cancelArmed : CONSOLE.cancel}
              </button>
            )}
          </div>

          {noScans && (
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] px-3.5 py-2.5 text-[12px] leading-5 text-cyan-100/85">
              <Info aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{CONSOLE.noScansBody}</span>
              <a
                href="#"
                className="glass-btn inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold text-white/85 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              >
                {CTAS.primary}
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            </div>
          )}

          <div data-testid="terminal-window" className="min-h-[160px] w-full flex-1">
            <Terminal
              lines={feedLines}
              busy={busy}
              busyText={CONSOLE.terminalBusy}
              title={CONSOLE.terminalTitle}
              username="dynix"
              hostname="local"
              enableSound={false}
              showSoundToggle={false}
              showControls={false}
              promptSymbol="➜"
              theme="carbon"
              fillHeight
              className="h-full"
            />
          </div>

          <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11px] text-white/45">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">
              {CONSOLE.scanIdLabel}:{" "}
              <span className="normal-case text-white/70" title={viewedScanId ?? undefined}>
                {viewedScanId ?? CONSOLE.noneNote}
              </span>
            </span>
            {viewedJob !== null && <ScanStatusBadge status={viewedJob.status} />}
            {scanActive && viewedJob?.progress !== null && viewedJob?.progress !== undefined && (
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-100/70">
                <LoaderCircle aria-hidden className="size-3 animate-spin" />
                {CONSOLE.stageLabel} {scanStagePosition(viewedJob.progress.stage)}/{scanStageTotal()} —{" "}
                {scanStageLabel(viewedJob.progress.stage)}
              </span>
            )}
            {viewedTerminal && viewedJob !== null && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {viewedJob.processCount} {CONSOLE.processCountLabel} · {viewedJob.findingsCount}{" "}
                {CONSOLE.findingsCountLabel} · {formatDuration(viewedJob.startedAt, viewedJob.completedAt)}
              </span>
            )}
            {redirecting && (
              <span className="inline-flex animate-pulse items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-200/80">
                {CONSOLE.autoOpenNote}
              </span>
            )}
            {viewedTerminal && viewedScanId !== null && (
              <a
                href={`#evidence/${encodeURIComponent(viewedScanId)}`}
                className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/85 transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              >
                {CONSOLE.viewReport}
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            )}
          </div>

          {(cancelError !== null ||
            (viewedTerminal && viewedJob !== null && viewedJob.error !== null) ||
            polling.connection === "polling-error" ||
            events.connection === "polling-error") && (
            <div className="mt-3 flex shrink-0 flex-col gap-2">
              {cancelError !== null && (
                <Notice tone="danger" icon={<AlertTriangle aria-hidden className="size-4" />}>
                  {cancelError}
                </Notice>
              )}
              {viewedTerminal && viewedJob !== null && viewedJob.error !== null && (
                <Notice tone="danger" icon={<AlertTriangle aria-hidden className="size-4" />}>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
                    {CONSOLE.failureLabel}: {viewedJob.error.code}
                  </span>{" "}
                  {viewedJob.error.message}
                </Notice>
              )}
              {polling.connection === "polling-error" && (
                <Notice
                  tone="warning"
                  testId="poll-degraded"
                  icon={<WifiOff aria-hidden className="size-4" />}
                  action={
                    <button
                      type="button"
                      onClick={polling.refresh}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 text-[11px] text-white/75 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                    >
                      <RefreshCw aria-hidden className="size-3" />
                      {CONSOLE.reconnect}
                    </button>
                  }
                >
                  {CONSOLE.pollDegradedNote}
                </Notice>
              )}
              {events.connection === "polling-error" && (
                <Notice
                  tone="warning"
                  testId="feed-degraded"
                  icon={<WifiOff aria-hidden className="size-4" />}
                  action={
                    <button
                      type="button"
                      onClick={events.refresh}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 text-[11px] text-white/75 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                    >
                      <RefreshCw aria-hidden className="size-3" />
                      {CONSOLE.reconnect}
                    </button>
                  }
                >
                  {CONSOLE.feedDegradedNote}
                </Notice>
              )}
            </div>
          )}

          {capabilities !== null && (
            <div className="mt-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              <span>
                {CONSOLE.platformLabel}: <span className="normal-case text-white/60">{capabilities.platform}</span>
              </span>
              <span>
                {CONSOLE.sourceLabel}:{" "}
                <span className="normal-case text-white/60">
                  {capabilities.collectorProvenance === "windows-native"
                    ? CONSOLE.sourceNative
                    : capabilities.collectorProvenance === "mocked"
                      ? CONSOLE.sourceMocked
                      : CONSOLE.noneNote}
                </span>
              </span>
              {featureEntries.map(({ key, value }) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${value.available ? "bg-emerald-400/80" : "bg-white/20"}`}
                  />
                  <span title={value.reason ?? undefined}>{CONSOLE.featureLabels[key]}</span>
                  <span className="sr-only">
                    {value.available ? CONSOLE.featureAvailable : CONSOLE.featureUnavailable}
                  </span>
                </span>
              ))}
            </div>
          )}

          <p className="mt-4 font-mono text-[10px] leading-4 tracking-[0.08em] text-white/35">
            {CONSOLE.scopeNote}
          </p>
        </motion.main>
      )}
    </section>
  );
}
