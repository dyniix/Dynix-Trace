import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EvidenceView from "@/components/evidence/evidence-view";
import {
  ScannerApiError,
  type Finding,
  type ProcessEvidence,
  type ScanJob,
  type ScanReport,
  type ScannerClient,
} from "@/lib/scanner-api";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

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
    findingsCount: 2,
    warnings: [],
    limitations: [],
    error: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    startedAt: "2026-10-01T10:00:01.000Z",
    completedAt: "2026-10-01T10:00:10.000Z",
    ...overrides,
  };
}

function findingFixture(): Finding {
  return {
    findingId: "finding-1",
    scanId: "scan-1",
    ruleId: "R1",
    category: "masquerading",
    title: "svchost.exe runs outside System32",
    description: "A system binary name was observed outside the system directory.",
    severity: "high",
    verificationStatus: "INFERRED",
    evidenceReferences: [{ kind: "process", refId: "ev-1", label: "svchost.exe (PID 42)" }],
    limitations: [],
    alternativeExplanations: [],
    createdAt: "2026-10-01T10:00:06.000Z",
  };
}

function evidenceRow(): ProcessEvidence {
  return {
    evidenceId: "ev-1",
    scanId: "scan-1",
    processId: 42,
    parentProcessId: { value: 4, status: "OBSERVED" },
    processName: { value: "svchost.exe", status: "OBSERVED" },
    executablePath: { value: "C:\\Users\\nik\\AppData\\Local\\Temp\\svchost.exe", status: "OBSERVED" },
    processStartTime: { value: "2026-10-01T09:00:00.000Z", status: "OBSERVED" },
    collectionTimestamp: "2026-10-01T10:00:05.000Z",
    executable: {
      evidenceId: "ev-1-exe",
      path: "C:\\Users\\nik\\AppData\\Local\\Temp\\svchost.exe",
      fileSizeBytes: { value: 2048, status: "OBSERVED" },
      createdAt: { value: "2026-01-01T00:00:00.000Z", status: "OBSERVED" },
      modifiedAt: { value: "2026-01-02T00:00:00.000Z", status: "OBSERVED" },
      sha256: { value: "a".repeat(64), status: "OBSERVED" },
      signature: { status: "UNSIGNED", method: "windows-authenticode", signerName: null },
      limitations: [],
    },
    source: "windows-native",
    limitations: [],
  };
}

function reportFixture(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    generatedAt: "2026-10-01T10:00:12.000Z",
    job: job(),
    findings: [findingFixture()],
    risk: {
      basis: "heuristic",
      score: 44,
      band: "ELEVATED",
      factors: [
        {
          id: "masquerading-system-binary",
          label: "System binary name outside System32",
          occurrences: 1,
          points: 25,
        },
        {
          id: "unsigned-executable-user-location",
          label: "Unsigned executable in user-writable location",
          occurrences: 2,
          points: 19,
        },
      ],
    },
    stats: {
      evidenceRecords: 2,
      evidenceTruncated: false,
      signatures: { valid: 0, unsigned: 2, invalid: 0, unknown: 0, unavailable: 0, notChecked: 0 },
      hashes: { present: 2, missing: 0 },
      paths: { withPath: 2, withoutPath: 0, system: 0, userWritable: 2, temp: 1, other: 0 },
    },
    ...overrides,
  };
}

function makeClient() {
  return {
    getCapabilities: vi.fn(),
    startScan: vi.fn(),
    getScan: vi.fn().mockResolvedValue(job()),
    listScans: vi.fn().mockResolvedValue([] as ScanJob[]),
    cancelScan: vi.fn(),
    getEvidence: vi.fn().mockResolvedValue({ evidence: [evidenceRow()], count: 1, limit: 50, offset: 0 }),
    getFindings: vi.fn().mockResolvedValue([findingFixture()]),
    getScanEvents: vi.fn().mockResolvedValue({ events: [], nextAfter: null }),
    getScanReport: vi.fn().mockResolvedValue(reportFixture()),
  };
}

function renderEvidence(client: ReturnType<typeof makeClient>, scanId: string | null) {
  return render(
    <EvidenceView
      scanId={scanId}
      client={client as unknown as ScannerClient}
      pollIntervalMs={10}
    />,
  );
}

describe("EvidenceView browser", () => {
  it("opens the newest recorded scan automatically", async () => {
    const client = makeClient();
    client.listScans.mockResolvedValue([job({ scanId: "scan-a" }), job({ scanId: "scan-b" })]);
    renderEvidence(client, null);

    await screen.findByTestId("evidence-risk-score");
    expect(client.getScanReport).toHaveBeenCalledWith("scan-a");
    expect(window.location.hash).toBe("#evidence/scan-a");
    expect(screen.getByRole("button", { name: "Recorded scan" }).textContent).toContain("scan-a");
  });

  it("switches the whole browser to another scan from the picker", async () => {
    const client = makeClient();
    client.listScans.mockResolvedValue([job({ scanId: "scan-a" }), job({ scanId: "scan-b" })]);
    renderEvidence(client, null);

    await screen.findByTestId("evidence-risk-score");
    fireEvent.click(screen.getByRole("button", { name: "Recorded scan" }));
    fireEvent.click(await screen.findByRole("option", { name: /scan-b/ }));

    await waitFor(() => expect(client.getScanReport).toHaveBeenCalledWith("scan-b"));
    expect(window.location.hash).toBe("#evidence/scan-b");
  });

  it("shows an honest empty state when no scans exist", async () => {
    const client = makeClient();
    renderEvidence(client, null);

    await screen.findByText("No scans recorded yet. Start the first trace from the home screen.");
    expect(screen.queryByTestId("evidence-risk-score")).toBeNull();
  });

  it("surfaces history failures and recovers on retry", async () => {
    const client = makeClient();
    client.listScans
      .mockRejectedValueOnce(new ScannerApiError("BACKEND_UNREACHABLE", 0, "down"))
      .mockResolvedValue([job({ scanId: "scan-a" })]);
    renderEvidence(client, null);

    await screen.findByText(/Could not load scan history./);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    await screen.findByTestId("evidence-risk-score");
    expect(client.getScanReport).toHaveBeenCalledWith("scan-a");
  });
});

describe("EvidenceView report", () => {
  it("renders risk ring, factors, stats, metadata, findings, and evidence", async () => {
    const client = makeClient();
    renderEvidence(client, "scan-1");

    const risk = await screen.findByTestId("evidence-risk-score");
    expect(risk.textContent).toContain("44");
    expect(screen.getAllByText("Elevated").length).toBeGreaterThan(0);
    expect(screen.getByText("System binary name outside System32")).toBeTruthy();
    expect(screen.getByText("+25")).toBeTruthy();
    expect(screen.getByText("Unsigned executable in user-writable location")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();

    expect(screen.getByText("Evidence records")).toBeTruthy();
    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(screen.getByText("Hashed")).toBeTruthy();
    expect(screen.getByText("User-writable")).toBeTruthy();
    expect(screen.getByText("Trace metadata")).toBeTruthy();
    expect(screen.getByText("Started")).toBeTruthy();

    expect(await screen.findByText("svchost.exe runs outside System32")).toBeTruthy();
    expect(await screen.findByText("svchost.exe")).toBeTruthy();
    expect(client.getScanReport).toHaveBeenCalledWith("scan-1");
    expect(screen.getByText("Heuristic score from recorded evidence — not a verdict. Findings are signals for human review.")).toBeTruthy();
  });

  it("copies the report JSON to the clipboard", async () => {
    const client = makeClient();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderEvidence(client, "scan-1");

    await screen.findByTestId("evidence-risk-score");
    fireEvent.click(screen.getByTestId("evidence-copy-json"));

    await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeText.mock.calls[0][0] as string) as ScanReport;
    expect(payload.risk.basis).toBe("heuristic");
    expect(payload.risk.score).toBe(44);
  });

  it("offers a JSON download built from the report payload", async () => {
    const client = makeClient();
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderEvidence(client, "scan-1");

    await screen.findByTestId("evidence-risk-score");
    fireEvent.click(screen.getByTestId("evidence-export-json"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("shows a not-found state for unknown scans", async () => {
    const client = makeClient();
    client.getScanReport.mockRejectedValue(new ScannerApiError("SCAN_NOT_FOUND", 404, "No scan."));
    renderEvidence(client, "scan-missing");

    await screen.findByText("Scan not found");
    expect(screen.getByText("This scan does not exist on the local backend.")).toBeTruthy();
  });

  it("surfaces report failures and recovers on retry", async () => {
    const client = makeClient();
    client.getScanReport
      .mockRejectedValueOnce(new ScannerApiError("BACKEND_UNREACHABLE", 0, "down"))
      .mockResolvedValue(reportFixture());
    renderEvidence(client, "scan-1");

    await screen.findByTestId("evidence-error");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    expect(await screen.findByTestId("evidence-risk-score")).toBeTruthy();
  });

  it("marks a running scan as partial and refetches the report once it completes", async () => {
    const client = makeClient();
    const running = job({
      scanId: "scan-live",
      status: "RUNNING",
      completedAt: null,
      progress: { stage: "INSPECTING_EXECUTABLES", stageIndex: 3, totalStages: 6 },
    });
    let terminal = false;
    client.getScan.mockImplementation(async () => (terminal ? job({ scanId: "scan-live" }) : running));
    client.getScanReport.mockImplementation(async () =>
      reportFixture({ job: terminal ? job({ scanId: "scan-live" }) : running }),
    );

    renderEvidence(client, "scan-live");

    await screen.findByText("This scan is still running — results keep settling until it completes.");
    expect(screen.getByRole("link", { name: /Watch live in console/ })).toBeTruthy();

    terminal = true;
    await waitFor(
      () => expect(screen.queryByText(/still running/)).toBeNull(),
      { timeout: 3000 },
    );
    expect(client.getScanReport.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
