import { useSyncExternalStore } from "react";
import {
  createScannerClient,
  isTerminalStatus,
  type ScanLifecycleStatus,
  type ScannerClient,
} from "@/lib/scanner-api";

export type ActiveScanState = {
  /** A start request is in flight — the start button must lock immediately. */
  starting: boolean;
  scanId: string | null;
  status: ScanLifecycleStatus | null;
};

export type ActiveScanView = ActiveScanState & { inProgress: boolean };

const IDLE: ActiveScanState = { starting: false, scanId: null, status: null };
const POLL_INTERVAL_MS = 2000;

const singletonClient = createScannerClient();

let activeClient: ScannerClient = singletonClient;
let state: ActiveScanState = IDLE;
let pollTimer: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: ActiveScanState): void {
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ActiveScanState {
  return state;
}

function deriveInProgress(snapshot: ActiveScanState): boolean {
  if (snapshot.starting) return true;
  if (snapshot.scanId === null) return false;
  return snapshot.status === null || !isTerminalStatus(snapshot.status);
}

/**
 * True while a scan started from home is still starting or running. The home
 * button derives its locked "Tracing…" state from this, so a second scan can
 * never be launched on top of a live one.
 */
export function isScanInProgress(): boolean {
  return deriveInProgress(state);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(scanId: string, delayMs: number): void {
  stopPolling();
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void pollScan(scanId);
  }, delayMs);
}

async function pollScan(scanId: string): Promise<void> {
  if (state.scanId !== scanId) return;
  try {
    const job = await activeClient.getScan(scanId);
    if (state.scanId !== scanId) return;
    if (isTerminalStatus(job.status)) {
      // The trace is over: unlock the home button and stop polling.
      setState(IDLE);
      return;
    }
    setState({ starting: false, scanId, status: job.status });
    schedulePoll(scanId, POLL_INTERVAL_MS);
  } catch {
    // A transient read failure never unlocks the button — the scan may still
    // be running. Keep polling instead of guessing.
    if (state.scanId === scanId) {
      schedulePoll(scanId, POLL_INTERVAL_MS);
    }
  }
}

/**
 * Starts the single home-initiated scan. Duplicate calls while a scan is
 * starting or running are ignored, so rapid clicks can never spawn parallel
 * scans. Rethrows start failures after releasing the lock.
 */
export async function startActiveScan(client: ScannerClient = activeClient): Promise<void> {
  activeClient = client;
  if (deriveInProgress(state)) return;
  setState({ starting: true, scanId: null, status: null });
  let result: { scanId: string; status: ScanLifecycleStatus };
  try {
    result = await client.startScan();
  } catch (error) {
    setState(IDLE);
    throw error;
  }
  if (isTerminalStatus(result.status)) {
    setState(IDLE);
    return;
  }
  setState({ starting: false, scanId: result.scanId, status: result.status });
  schedulePoll(result.scanId, 0);
}

/**
 * Reload recovery: if the page was refreshed mid-scan, the store is empty
 * while the backend keeps running. Adopt the newest non-terminal scan so the
 * home button resumes its locked "Tracing…" state instead of offering a
 * duplicate start.
 */
export async function adoptRunningScan(client: ScannerClient = activeClient): Promise<void> {
  activeClient = client;
  if (state.scanId !== null || state.starting) return;
  try {
    const scans = await client.listScans(10);
    if (state.scanId !== null || state.starting) return;
    const running = scans.find((scan) => !isTerminalStatus(scan.status));
    if (running === undefined) return;
    setState({ starting: false, scanId: running.scanId, status: running.status });
    schedulePoll(running.scanId, 0);
  } catch {
    // Backend unreachable: stay idle and let an explicit start surface the error.
  }
}

/** Test seam: restores the module singleton to a clean idle state. */
export function resetActiveScanStore(client: ScannerClient = singletonClient): void {
  stopPolling();
  activeClient = client;
  state = IDLE;
  emit();
}

export function useActiveScan(): ActiveScanView {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, inProgress: deriveInProgress(snapshot) };
}
