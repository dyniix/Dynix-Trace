import { describe, expect, it, vi } from "vitest";
import { createScannerClient, ScannerApiError } from "@/lib/scanner-api";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn((url: string, init?: RequestInit) => handler(url, init));
}

function scanJob(overrides: Record<string, unknown> = {}) {
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

async function expectApiError(promise: Promise<unknown>): Promise<ScannerApiError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ScannerApiError);
  return caught as ScannerApiError;
}

describe("scanner-api client", () => {
  it("getScan sends a single GET and returns the parsed scan envelope", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ scan: scanJob() }));
    const client = createScannerClient("http://api.test", fetchMock);

    const job = await client.getScan("scan 1/x");

    expect(job.scanId).toBe("scan-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/scanner/scans/scan%201%2Fx");
    expect(fetchMock.mock.calls[0][1]?.method ?? "GET").toBe("GET");
  });

  it("deduplicates identical concurrent GETs and allows fresh requests afterwards", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ scan: scanJob() }));
    const client = createScannerClient("http://api.test", fetchMock);

    const [a, b] = await Promise.all([client.getScan("scan-1"), client.getScan("scan-1")]);
    expect(a.scanId).toBe(b.scanId);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await client.getScan("scan-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("startScan POSTs an empty JSON body and returns the scan summary", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({ scan: { scanId: "scan-9", status: "QUEUED" } }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const result = await client.startScan();

    expect(result).toEqual({ scanId: "scan-9", status: "QUEUED" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/scanner/scans");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("cancelScan POSTs to the cancel route", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({ scan: { scanId: "scan-1", status: "CANCELLED" } }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const result = await client.cancelScan("scan-1");

    expect(result.status).toBe("CANCELLED");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/scanner/scans/scan-1/cancel");
    expect(init?.method).toBe("POST");
  });

  it("listScans passes the limit and validates every job", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ scans: [scanJob(), scanJob({ scanId: "scan-2" })] }));
    const client = createScannerClient("http://api.test", fetchMock);

    const jobs = await client.listScans(25);

    expect(jobs.map((job) => job.scanId)).toEqual(["scan-1", "scan-2"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/scanner/scans?limit=25");
  });

  it("rejects list entries with an unknown lifecycle status as INVALID_RESPONSE", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ scans: [scanJob({ status: "BOGUS" })] }));
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.listScans(25));

    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.status).toBe(0);
  });

  it("getEvidence builds the limit/offset query and parses the page", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({ evidence: [], count: 0, limit: 50, offset: 100 }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const page = await client.getEvidence("scan-1", { limit: 50, offset: 100 });

    expect(page.offset).toBe(100);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.test/api/scanner/scans/scan-1/evidence?limit=50&offset=100",
    );
  });

  it("rejects an evidence envelope without an evidence array", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ count: 0 }));
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(
      client.getEvidence("scan-1", { limit: 50, offset: 0 }),
    );

    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("getFindings returns the findings array", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ findings: [] }));
    const client = createScannerClient("http://api.test", fetchMock);

    expect(await client.getFindings("scan-1")).toEqual([]);
  });

  it("getCapabilities unwraps the capabilities envelope", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        capabilities: { platform: "win32", osSupported: true, features: {}, limitations: [] },
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const capabilities = await client.getCapabilities();

    expect(capabilities.platform).toBe("win32");
  });

  it("rejects capabilities without platform as INVALID_RESPONSE", async () => {
    const fetchMock = makeFetch(async () => jsonResponse({ capabilities: { osSupported: true } }));
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getCapabilities());

    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("maps backend error envelopes to ScannerApiError with code and status", async () => {
    const fetchMock = makeFetch(async () =>
      new Response(JSON.stringify({ error: { code: "INVALID_TRANSITION", message: "Scan is not running." } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.cancelScan("scan-1"));

    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Scan is not running.");
  });

  it("keeps HTTP defaults for non-JSON error bodies", async () => {
    const fetchMock = makeFetch(async () => new Response("boom", { status: 500 }));
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getScan("scan-1"));

    expect(error.code).toBe("HTTP_500");
    expect(error.status).toBe(500);
  });

  it("maps transport failures to BACKEND_UNREACHABLE", async () => {
    const fetchMock = makeFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getScan("scan-1"));

    expect(error.code).toBe("BACKEND_UNREACHABLE");
    expect(error.status).toBe(0);
  });

  it("rejects a 200 response whose body is not JSON as INVALID_RESPONSE", async () => {
    const fetchMock = makeFetch(async () => new Response("<html>hi</html>", { status: 200 }));
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getScan("scan-1"));

    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("getScanEvents builds the after/limit cursor query and parses events", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        events: [
          { seq: 4, kind: "command", text: "dynix-trace scan", createdAt: "2026-10-01T10:00:02.000Z" },
          { seq: 5, kind: "risk", text: "HIGH · svchost.exe", createdAt: "2026-10-01T10:00:03.000Z" },
        ],
        count: 2,
        nextAfter: 5,
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const page = await client.getScanEvents("scan 1/x", { after: 3, limit: 500 });

    expect(page.events.map((event) => event.seq)).toEqual([4, 5]);
    expect(page.events[1]!.kind).toBe("risk");
    expect(page.nextAfter).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.test/api/scanner/scans/scan%201%2Fx/events?after=3&limit=500",
    );
  });

  it("falls back to the last event seq when nextAfter is missing", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        events: [{ seq: 9, kind: "info", text: "x", createdAt: "2026-10-01T10:00:02.000Z" }],
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const page = await client.getScanEvents("scan-1", { after: 0 });

    expect(page.nextAfter).toBe(9);
  });

  it("rejects events with unknown kinds as INVALID_RESPONSE", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        events: [{ seq: 1, kind: "scream", text: "x", createdAt: "2026-10-01T10:00:02.000Z" }],
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getScanEvents("scan-1", { after: 0 }));

    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("getScanReport unwraps the report envelope", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        report: {
          generatedAt: "2026-10-01T10:00:12.000Z",
          job: scanJob(),
          findings: [],
          risk: { basis: "heuristic", score: 12, band: "LOW", factors: [] },
          stats: {
            evidenceRecords: 0,
            evidenceTruncated: false,
            signatures: { valid: 0, unsigned: 0, invalid: 0, unknown: 0, unavailable: 0, notChecked: 0 },
            hashes: { present: 0, missing: 0 },
            paths: { withPath: 0, withoutPath: 0, system: 0, userWritable: 0, temp: 0, other: 0 },
          },
        },
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const report = await client.getScanReport("scan-1");

    expect(report.risk.score).toBe(12);
    expect(report.risk.band).toBe("LOW");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/scanner/scans/scan-1/report");
  });

  it("rejects a report whose risk basis is not heuristic", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse({
        report: {
          generatedAt: "2026-10-01T10:00:12.000Z",
          job: scanJob(),
          findings: [],
          risk: { basis: "vibes", score: 12, band: "LOW", factors: [] },
          stats: {},
        },
      }),
    );
    const client = createScannerClient("http://api.test", fetchMock);

    const error = await expectApiError(client.getScanReport("scan-1"));

    expect(error.code).toBe("INVALID_RESPONSE");
  });
});
