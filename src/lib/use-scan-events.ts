import { useCallback, useEffect, useRef, useState } from "react";
import { ScannerApiError, type ScanEvent, type ScannerClient } from "@/lib/scanner-api";

export type ScanEventsConnection = "idle" | "ok" | "polling-error";

export type ScanEventsState = {
  events: ScanEvent[];
  connection: ScanEventsConnection;
  connectionMessage: string | null;
};

export type UseScanEventsOptions = {
  /** True while the scan is still running; polling continues with a short interval. */
  active: boolean;
  pollIntervalMs?: number;
  maxEvents?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 700;
const EVENT_BATCH_LIMIT = 500;
const DEFAULT_MAX_EVENTS = 600;
const FINAL_SETTLE_MS = 500;

function messageOf(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected events error.";
}

/**
 * Streams a scan's console feed with an `after` cursor.
 *
 * While `active` is true it polls quickly and appends only newly sequenced
 * events. When the scan reaches a terminal state the hook performs a final
 * fetch (plus one short settle fetch — the backend persists the terminal job
 * status just before it writes the last feed lines) and then stops. Failures
 * degrade the connection badge; they never clear already received lines.
 */
export function useScanEvents(
  client: ScannerClient,
  scanId: string | null,
  options: UseScanEventsOptions,
): ScanEventsState & { refresh: () => void } {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const [state, setState] = useState<ScanEventsState>({
    events: [],
    connection: "idle",
    connectionMessage: null,
  });
  const lastSeqRef = useRef(0);
  const eventsRef = useRef<ScanEvent[]>([]);
  const disposedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const scanIdRef = useRef<string | null>(scanId);
  const activeRef = useRef(options.active);
  const previousScanIdRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchBatch = useCallback(async (): Promise<boolean> => {
    const id = scanIdRef.current;
    if (id === null) return false;
    try {
      const page = await client.getScanEvents(id, {
        after: lastSeqRef.current,
        limit: EVENT_BATCH_LIMIT,
      });
      if (disposedRef.current || scanIdRef.current !== id) return false;
      const fresh = page.events.filter((event) => event.seq > lastSeqRef.current);
      if (fresh.length > 0) {
        lastSeqRef.current = fresh[fresh.length - 1]!.seq;
        const merged = [...eventsRef.current, ...fresh].slice(-maxEvents);
        eventsRef.current = merged;
        setState((previous) => ({
          ...previous,
          events: merged,
          connection: "ok",
          connectionMessage: null,
        }));
      } else {
        setState((previous) =>
          previous.connection === "idle"
            ? { ...previous, connection: "ok", connectionMessage: null }
            : previous,
        );
      }
      return page.events.length >= EVENT_BATCH_LIMIT;
    } catch (error) {
      if (disposedRef.current || scanIdRef.current !== id) return false;
      setState((previous) => ({
        ...previous,
        connection: "polling-error",
        connectionMessage: messageOf(error),
      }));
      return true;
    }
  }, [client, maxEvents]);

  const loopRef = useRef<() => void>(() => {});

  const schedule = useCallback(
    (delay: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        loopRef.current();
      }, delay);
    },
    [clearTimer],
  );

  const loop = useCallback(async () => {
    const more = await fetchBatch();
    if (disposedRef.current) return;
    if (activeRef.current || more) {
      schedule(pollIntervalMs);
    }
  }, [fetchBatch, pollIntervalMs, schedule]);

  loopRef.current = () => {
    void loop();
  };

  const refresh = useCallback(() => {
    if (scanIdRef.current === null) return;
    clearTimer();
    void loop();
  }, [loop, clearTimer]);

  useEffect(() => {
    disposedRef.current = false;
    const scanChanged = previousScanIdRef.current !== scanId;
    previousScanIdRef.current = scanId;
    scanIdRef.current = scanId;
    activeRef.current = options.active;
    clearTimer();

    if (scanChanged) {
      lastSeqRef.current = 0;
      eventsRef.current = [];
      setState({ events: [], connection: "idle", connectionMessage: null });
    }

    if (scanId === null) {
      return;
    }

    if (options.active) {
      void loop();
    } else {
      // Terminal (or historical) scan: fetch now, then once more after a
      // short settle window — the backend writes the final feed lines just
      // after the terminal job status becomes visible.
      void (async () => {
        await fetchBatch();
        await new Promise((resolve) => window.setTimeout(resolve, FINAL_SETTLE_MS));
        if (!disposedRef.current && scanIdRef.current === scanId) {
          await fetchBatch();
        }
      })();
    }

    return () => {
      disposedRef.current = true;
      clearTimer();
    };
  }, [scanId, options.active, loop, fetchBatch, clearTimer]);

  return { ...state, refresh };
}
