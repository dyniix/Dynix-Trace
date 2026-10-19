import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConsoleView from "@/components/console/console-view";
import {
  ScannerApiError,
  type Finding,
  type ScanEvent,
  type ScanJob,
  type ScannerCapabilities,
  type ScannerClient,
} from "@/lib/scanner-api";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const readyCapabilities: ScannerCapabilities = {
  platform: "win32",
  osSupported: true,
  collectorProvenance: "windows-native",
  scannerVersion: "1.0.0",
  features: {
    processInventory: { available: true, reason: null },
    executableMetadata: { available: true, reason: null },
    sha256Hashing: { available: true, reason: null },
    signatureVerification: { available: true, reason: null },
  },
  limitations: [],
};

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

function runningJob(scanId: string): ScanJob {
  return job({
    scanId,
    status: "RUNNING",
    progress: { stage: "ENUMERATING_PROCESSES", stageIndex: 1, totalStages: 6 },
    processCount: 0,
    findingsCount: 0,
    completedAt: null,
  });
}

function eventFixture(seq: number, kind: ScanEvent["kind"], text: string): ScanEvent {
  return { seq, kind, text, createdAt: "2026-10-01T10:00:02.000Z" };
}

const scanCommand = "dynix-trace scan --profile=process-inventory";

function makeClient() {
  return {
    getCapabilities: vi.fn().mockResolvedValue(readyCapabilities),
    startScan: vi.fn().mockResolvedValue({ scanId: "scan-new", status: "QUEUED" }),
    getScan: vi.fn().mockResolvedValue(job({ scanId: "scan-solo" })),
    listScans: vi.fn().mockResolvedValue([] as ScanJob[]),
    cancelScan: vi.fn().mockResolvedValue({ scanId: "scan-new", status: "CANCELLED" }),
    getEvidence: vi.fn().mockResolvedValue({ evidence: [], count: 0, limit: 50, offset: 0 }),
    getFindings: vi.fn().mockResolvedValue([] as Finding[]),
    getScanEvents: vi.fn().mockResolvedValue({ events: [], nextAfter: null }),
    getScanReport: vi.fn().mockResolvedValue(null),
  };
}

/** The console is a viewer: feed tests start from a scan already in history. */
function runningClient(scanId = "scan-new") {
  const client = makeClient();
  client.listScans.mockResolvedValue([runningJob(scanId)]);
  client.getScan.mockResolvedValue(runningJob(scanId));
  return client;
}

function renderConsole(client: ReturnType<typeof makeClient>) {
  render(
    <ConsoleView
      client={client as unknown as ScannerClient}
      pollIntervalMs={10}
      eventPollIntervalMs={10}
    />,
  );
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("ConsoleView bootstrap", () => {
  it("shows the offline state when capabilities are unreachable and recovers via Retry", async () => {
    const client = makeClient();
    client.getCapabilities.mockRejectedValueOnce(
      new ScannerApiError("BACKEND_UNREACHABLE", 0, "Local backend is not reachable."),
    );
    renderConsole(client);

    await screen.findByRole("heading", { name: "Backend offline" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Trace Console");
    expect(client.getCapabilities).toHaveBeenCalledTimes(2);
  });

  it("shows the scanner-unavailable state with backend limitations", async () => {
    const client = makeClient();
    client.getCapabilities.mockResolvedValue({
      ...readyCapabilities,
      osSupported: false,
      features: {
        ...readyCapabilities.features,
        processInventory: { available: false, reason: "unsupported platform" },
      },
      limitations: ["Process inventory requires Windows."],
    });
    renderConsole(client);

    await screen.findByText("Scanner unavailable");
    expect(screen.getByText("Process inventory requires Windows.")).toBeTruthy();
  });

  it("shows the invalid-response state for unreadable capability payloads", async () => {
    const client = makeClient();
    client.getCapabilities.mockRejectedValue(
      new ScannerApiError("INVALID_RESPONSE", 0, "Unexpected backend response: missing platform."),
    );
    renderConsole(client);

    await screen.findByText("Unexpected backend response");
  });

  it("renders the quiet ready console without any start control", async () => {
    const client = makeClient();
    renderConsole(client);

    await screen.findByText("Trace Console");
    expect(screen.getByText("Backend online")).toBeTruthy();
    expect(screen.getByText("Windows native")).toBeTruthy();
    expect(
      screen.getByText("no scans recorded yet — start the first trace from the home screen."),
    ).toBeTruthy();
    expect(screen.getByTestId("terminal-window")).toBeTruthy();
    expect(screen.queryByTestId("terminal-busy")).toBeNull();
    expect(screen.queryByTestId("start-scan")).toBeNull();
    expect(client.startScan).not.toHaveBeenCalled();
  });

  it("points to the home screen when no trace exists yet", async () => {
    const client = makeClient();
    renderConsole(client);

    await screen.findByText(/Scans start from the home screen/);
    const cta = screen.getByRole("link", { name: /Initiate Scan/ }) as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("#");
  });
});

describe("ConsoleView live terminal", () => {
  it("streams the newest running scan's feed and never calls startScan", async () => {
    const client = runningClient();
    client.getScanEvents.mockResolvedValue({
      events: [
        eventFixture(1, "command", scanCommand),
        eventFixture(2, "info", "enumerated 2 processes"),
      ],
      nextAfter: 2,
    });
    renderConsole(client);
    await screen.findByText("Trace Console");

    await waitFor(() =>
      expect(bodyText()).toContain("dynix-trace scan --profile=process-inventory"),
    );
    expect(await screen.findByText("enumerated 2 processes")).toBeTruthy();
    expect(screen.getByTestId("terminal-busy")).toBeTruthy();
    await screen.findByText(/Enumerating processes/);
    expect(screen.getByText(/2\/6/)).toBeTruthy();

    expect(client.startScan).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain("%");
  });

  it("renders risk lines in red while quiet steps stay neutral", async () => {
    const client = runningClient();
    client.getScanEvents.mockResolvedValue({
      events: [
        eventFixture(1, "command", scanCommand),
        eventFixture(2, "risk", "HIGH · svchost.exe runs outside System32 — masquerading"),
        eventFixture(3, "info", "collected metadata for 2 processes"),
      ],
      nextAfter: 3,
    });
    renderConsole(client);
    await screen.findByText("Trace Console");

    const riskLine = await screen.findByText(/HIGH · svchost\.exe runs outside System32/);
    expect(riskLine.className).toContain("text-red-300");

    const quietLine = screen.getByText("collected metadata for 2 processes");
    expect(quietLine.className).toContain("text-cyan-200");
    expect(quietLine.className).not.toContain("text-red-300");
  });

  it("shows the final feed line, stops the spinner, and auto-opens the report on completion", async () => {
    const client = runningClient();
    let call = 0;
    client.getScan.mockImplementation(async () => {
      call += 1;
      return call <= 2 ? runningJob("scan-new") : job({ scanId: "scan-new" });
    });
    client.getScanEvents.mockResolvedValue({
      events: [
        eventFixture(1, "command", scanCommand),
        eventFixture(2, "success", "trace complete — report ready"),
      ],
      nextAfter: 2,
    });
    renderConsole(client);
    await screen.findByTestId("terminal-busy");

    expect(await screen.findByText("trace complete — report ready")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("terminal-busy")).toBeNull());

    const reportLink = screen.getByRole("link", { name: /View report/ }) as HTMLAnchorElement;
    expect(reportLink.getAttribute("href")).toBe("#evidence/scan-new");
    await waitFor(() => expect(window.location.hash).toBe("#evidence/scan-new"), { timeout: 3000 });
    expect(client.listScans.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("never auto-opens the report for a failed scan and explains the failure", async () => {
    const client = makeClient();
    client.listScans.mockResolvedValue([
      job({
        scanId: "scan-new",
        status: "FAILED",
        error: { code: "PS_UNAVAILABLE", message: "PowerShell is not available." },
      }),
    ]);
    client.getScan.mockResolvedValue(
      job({
        scanId: "scan-new",
        status: "FAILED",
        error: { code: "PS_UNAVAILABLE", message: "PowerShell is not available." },
      }),
    );
    client.getScanEvents.mockResolvedValue({
      events: [
        eventFixture(1, "command", scanCommand),
        eventFixture(2, "error", "scan FAILED · PS_UNAVAILABLE — PowerShell is not available."),
      ],
      nextAfter: 2,
    });
    renderConsole(client);
    await screen.findByText("Trace Console");

    const failedLine = await screen.findByText(/scan FAILED · PS_UNAVAILABLE/);
    expect(failedLine.className).toContain("text-red-300");
    await screen.findByText(/Failure: PS_UNAVAILABLE/);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(window.location.hash).not.toBe("#evidence/scan-new");
    expect(screen.getByRole("link", { name: /View report/ })).toBeTruthy();
  });

  it("keeps polling failures non-destructive and recovers via Reconnect", async () => {
    const client = runningClient();
    let call = 0;
    let failing = false;
    client.getScan.mockImplementation(async () => {
      call += 1;
      if (call > 1 && failing) {
        throw new ScannerApiError("BACKEND_UNREACHABLE", 0, "Local backend is not reachable.");
      }
      return runningJob("scan-new");
    });
    renderConsole(client);
    await screen.findByTestId("terminal-busy");

    failing = true;
    await screen.findByTestId("poll-degraded", {}, { timeout: 3000 });
    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(screen.queryByTestId("poll-degraded")).toBeNull());
  });

  it("cancels a running scan only after explicit confirmation", async () => {
    const client = makeClient();
    let cancelled = false;
    client.listScans.mockResolvedValue([runningJob("scan-new")]);
    client.getScan.mockImplementation(async () =>
      cancelled ? job({ scanId: "scan-new", status: "CANCELLED" }) : runningJob("scan-new"),
    );
    client.getScanEvents.mockImplementation(async () => ({
      events: cancelled
        ? [
            eventFixture(1, "command", scanCommand),
            eventFixture(2, "warn", "scan cancelled by operator"),
          ]
        : [eventFixture(1, "command", scanCommand)],
      nextAfter: cancelled ? 2 : 1,
    }));
    client.cancelScan.mockImplementation(async (scanId: string) => {
      cancelled = true;
      return { scanId, status: "CANCELLED" };
    });
    renderConsole(client);

    await screen.findByTestId("terminal-busy");
    await screen.findAllByText("Running");

    fireEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
    expect(client.cancelScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    await waitFor(() => expect(client.cancelScan).toHaveBeenCalledWith("scan-new"));
    await screen.findAllByText("Cancelled");
    expect(await screen.findByText("scan cancelled by operator")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel scan/i })).toBeNull());
  });
});

describe("ConsoleView scan picker", () => {
  it("switches to an older recorded feed without starting a scan", async () => {
    const client = makeClient();
    const oldJob = job({ scanId: "scan-old", processCount: 1 });
    const newest = job({ scanId: "scan-newest", processCount: 4 });
    client.listScans.mockResolvedValue([newest, oldJob]);
    client.getScan.mockImplementation(async (scanId: string) =>
      scanId === "scan-old" ? oldJob : newest,
    );
    client.getScanEvents.mockImplementation(async (scanId: string) =>
      scanId === "scan-old"
        ? {
            events: [
              eventFixture(1, "command", scanCommand),
              eventFixture(2, "risk", "HIGH · unsigned executable in user-writable location"),
              eventFixture(3, "success", "trace complete — report ready"),
            ],
            nextAfter: 3,
          }
        : { events: [], nextAfter: null },
    );
    renderConsole(client);
    await screen.findByText("Trace Console");

    fireEvent.click(screen.getByRole("button", { name: "Recent scans" }));
    fireEvent.click(await screen.findByRole("option", { name: /scan-old/ }));

    const riskLine = await screen.findByText(/HIGH · unsigned executable in user-writable location/);
    expect(riskLine.className).toContain("text-red-300");
    expect(await screen.findByText("trace complete — report ready")).toBeTruthy();
    expect(client.startScan).not.toHaveBeenCalled();
    expect(client.getScanEvents).toHaveBeenCalledWith("scan-old", { after: 0, limit: 500 });
    expect(screen.queryByTestId("terminal-busy")).toBeNull();
    expect(window.location.hash).not.toContain("#evidence/");
  });

  it("shows a history error and recovers on retry", async () => {
    const client = makeClient();
    client.listScans
      .mockRejectedValueOnce(new ScannerApiError("BACKEND_UNREACHABLE", 0, "down"))
      .mockResolvedValue([job({ scanId: "scan-old" })]);
    client.getScan.mockResolvedValue(job({ scanId: "scan-old" }));
    renderConsole(client);

    await screen.findByText("Could not load scan history.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Recent scans" }).textContent).toContain("scan-old"),
    );
  });

  it("disables the picker while a scan is running", async () => {
    const client = runningClient();
    renderConsole(client);
    await screen.findByTestId("terminal-busy");

    const trigger = screen.getByRole("button", { name: "Recent scans" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
