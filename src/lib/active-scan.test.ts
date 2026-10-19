import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptRunningScan,
  isScanInProgress,
  resetActiveScanStore,
  startActiveScan,
} from "@/lib/active-scan";
import { ScannerApiError, type ScanJob, type ScannerClient } from "@/lib/scanner-api";

function job(overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    scanId: "scan-1",
    status: "COMPLETED",
    platform: "win32",
    scannerVersion: "1.0.0",
    collectorProvenance: "windows-native",
    progress: null,
    checksAttempted: 4,
    checksCompleted: 4,
    processCount: 4,
    findingsCount: 0,
    warnings: [],
    limitations: [],
    error: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    startedAt: "2026-10-01T10:00:01.000Z",
    completedAt: "2026-10-01T10:00:10.000Z",
    ...overrides,
  };
}

function makeClient() {
  return {
    startScan: vi.fn(),
    getScan: vi.fn(),
    listScans: vi.fn().mockResolvedValue([] as ScanJob[]),
  };
}

function asClient(client: ReturnType<typeof makeClient>): ScannerClient {
  return client as unknown as ScannerClient;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetActiveScanStore();
  vi.useRealTimers();
});

describe("active-scan store", () => {
  it("locks the instant a start is requested and ignores repeat starts in flight", async () => {
    const client = makeClient();
    let release: (value: { scanId: string; status: "QUEUED" }) => void = () => {};
    client.startScan.mockImplementation(
      () =>
        new Promise<{ scanId: string; status: "QUEUED" }>((resolve) => {
          release = resolve;
        }),
    );
    client.getScan.mockResolvedValue(job({ scanId: "scan-1", status: "RUNNING", completedAt: null }));
    resetActiveScanStore(asClient(client));

    const first = startActiveScan(asClient(client));
    expect(isScanInProgress()).toBe(true);

    await startActiveScan(asClient(client));
    expect(client.startScan).toHaveBeenCalledTimes(1);

    release({ scanId: "scan-1", status: "QUEUED" });
    await first;
    expect(isScanInProgress()).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(isScanInProgress()).toBe(true);
  });

  it("polls while running and unlocks the moment the scan reaches a terminal state", async () => {
    const client = makeClient();
    client.startScan.mockResolvedValue({ scanId: "scan-1", status: "QUEUED" });
    client.getScan
      .mockResolvedValueOnce(job({ scanId: "scan-1", status: "RUNNING", completedAt: null }))
      .mockResolvedValueOnce(job({ scanId: "scan-1", status: "COMPLETED" }));
    resetActiveScanStore(asClient(client));

    await startActiveScan(asClient(client));
    expect(isScanInProgress()).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(isScanInProgress()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(isScanInProgress()).toBe(false);

    const callsAfterUnlock = client.getScan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(client.getScan.mock.calls.length).toBe(callsAfterUnlock);
  });

  it("keeps the lock through transient poll failures and retries", async () => {
    const client = makeClient();
    client.startScan.mockResolvedValue({ scanId: "scan-1", status: "QUEUED" });
    client.getScan.mockRejectedValueOnce(new Error("backend down"));
    resetActiveScanStore(asClient(client));

    await startActiveScan(asClient(client));
    await vi.advanceTimersByTimeAsync(0);
    expect(isScanInProgress()).toBe(true);

    await startActiveScan(asClient(client));
    expect(client.startScan).toHaveBeenCalledTimes(1);

    client.getScan.mockResolvedValue(job({ scanId: "scan-1", status: "COMPLETED" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(isScanInProgress()).toBe(false);
  });

  it("releases the lock and rethrows when the start request fails", async () => {
    const client = makeClient();
    client.startScan.mockRejectedValue(new ScannerApiError("BACKEND_UNREACHABLE", 0, "down"));
    resetActiveScanStore(asClient(client));

    await expect(startActiveScan(asClient(client))).rejects.toBeInstanceOf(ScannerApiError);
    expect(isScanInProgress()).toBe(false);

    client.startScan.mockResolvedValue({ scanId: "scan-2", status: "QUEUED" });
    client.getScan.mockResolvedValue(job({ scanId: "scan-2", status: "RUNNING", completedAt: null }));
    await startActiveScan(asClient(client));
    expect(client.startScan).toHaveBeenCalledTimes(2);
    expect(isScanInProgress()).toBe(true);
  });

  it("adopts a running scan after reload and blocks a duplicate start", async () => {
    const client = makeClient();
    client.listScans.mockResolvedValue([
      job({ scanId: "scan-done", status: "COMPLETED" }),
      job({ scanId: "scan-live", status: "RUNNING", completedAt: null }),
      job({ scanId: "scan-old", status: "CANCELLED" }),
    ]);
    client.getScan.mockResolvedValue(job({ scanId: "scan-live", status: "RUNNING", completedAt: null }));
    resetActiveScanStore(asClient(client));

    await adoptRunningScan(asClient(client));
    expect(isScanInProgress()).toBe(true);

    await startActiveScan(asClient(client));
    expect(client.startScan).not.toHaveBeenCalled();
  });

  it("stays idle when every scan in history is terminal", async () => {
    const client = makeClient();
    client.listScans.mockResolvedValue([
      job({ status: "COMPLETED" }),
      job({ scanId: "scan-2", status: "FAILED" }),
    ]);
    resetActiveScanStore(asClient(client));

    await adoptRunningScan(asClient(client));
    expect(isScanInProgress()).toBe(false);
  });

  it("stays idle when the backend is unreachable during adoption", async () => {
    const client = makeClient();
    client.listScans.mockRejectedValue(new ScannerApiError("BACKEND_UNREACHABLE", 0, "down"));
    resetActiveScanStore(asClient(client));

    await expect(adoptRunningScan(asClient(client))).resolves.toBeUndefined();
    expect(isScanInProgress()).toBe(false);
  });
});
