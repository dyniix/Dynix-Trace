import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTerminalStatus,
  ScannerApiError,
  type ScanJob,
  type ScannerClient,
} from "@/lib/scanner-api";

export type ScanPollingConnection = "idle" | "ok" | "polling-error";

export type ScanPollingState = {
  job: ScanJob | null;
  connection: ScanPollingConnection;
  connectionMessage: string | null;
};

export type UseScanPollingOptions = {
  pollIntervalMs?: number;
  maxBackoffMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_MAX_BACKOFF_MS = 8000;

function messageOf(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected polling error.";
}

/**
 * Polls a scan until it reaches a terminal state.
 *
 * Deliberately conservative: a temporary polling failure only marks the
 * connection as degraded and keeps retrying with backoff. It never marks
 * the scan as FAILED and never starts another scan. Unmounting stops the
 * polling loop but does not cancel the backend scan.
 */
export function useScanPolling(
  client: ScannerClient,
  scanId: string | null,
  options: UseScanPollingOptions = {},
): ScanPollingState & { refresh: () => void } {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const [state, setState] = useState<ScanPollingState>({
    job: null,
    connection: "idle",
    connectionMessage: null,
  });
  const failuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const scanIdRef = useRef<string | null>(scanId);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollRef = useRef<() => void>(() => {});

  const schedule = useCallback(
    (delay: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        pollRef.current();
      }, delay);
    },
    [clearTimer],
  );

  const poll = useCallback(async () => {
    const id = scanIdRef.current;
    if (id === null) return;
    try {
      const job = await client.getScan(id);
      if (disposedRef.current || scanIdRef.current !== id) return;
      failuresRef.current = 0;
      setState({ job, connection: "ok", connectionMessage: null });
      if (!isTerminalStatus(job.status)) {
        schedule(pollIntervalMs);
      }
    } catch (error) {
      if (disposedRef.current || scanIdRef.current !== id) return;
      failuresRef.current += 1;
      setState((previous) => ({
        job: previous.job,
        connection: "polling-error",
        connectionMessage: messageOf(error),
      }));
      const permanent =
        error instanceof ScannerApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429;
      if (!permanent) {
        const delay = Math.min(pollIntervalMs * 2 ** (failuresRef.current - 1), maxBackoffMs);
        schedule(delay);
      }
    }
  }, [client, pollIntervalMs, maxBackoffMs, schedule]);

  pollRef.current = () => {
    void poll();
  };

  const refresh = useCallback(() => {
    if (scanIdRef.current === null) return;
    failuresRef.current = 0;
    clearTimer();
    void poll();
  }, [poll, clearTimer]);

  useEffect(() => {
    disposedRef.current = false;
    scanIdRef.current = scanId;
    failuresRef.current = 0;
    clearTimer();
    if (scanId === null) {
      setState({ job: null, connection: "idle", connectionMessage: null });
      return;
    }
    setState((previous) => ({
      job: previous.job !== null && previous.job.scanId === scanId ? previous.job : null,
      connection: "idle",
      connectionMessage: null,
    }));
    void poll();
    return () => {
      disposedRef.current = true;
      clearTimer();
    };
  }, [scanId, poll, clearTimer]);

  return { ...state, refresh };
}
