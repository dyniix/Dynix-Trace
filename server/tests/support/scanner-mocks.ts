import type {
  ProcessCollectionOutcome,
  ProcessInventoryCollector,
  RawProcessRecord,
} from "../../src/scanner/ports.ts";
import type { ScanWarning } from "../../src/scanner/contracts.ts";
import type { NormalizeContext } from "../../src/scanner/normalize.ts";

export const MOCK_SCAN_ID = "scan-mock-1";
export const MOCK_COLLECTION_TIMESTAMP = "2026-01-01T00:00:00.000Z";
export const MOCK_SCANNER_VERSION = "mock-0.0.0";

export function createMockProcessCollector(
  records: RawProcessRecord[],
  options: {
    complete?: boolean;
    warnings?: ScanWarning[];
    limitations?: string[];
    attempted?: number;
    completed?: number;
    scannerVersion?: string;
  } = {},
): ProcessInventoryCollector {
  const outcome: ProcessCollectionOutcome = {
    records,
    attempted: options.attempted ?? records.length,
    completed: options.completed ?? records.length,
    complete: options.complete ?? true,
    warnings: options.warnings ?? [],
    limitations: options.limitations ?? [],
  };
  return {
    provenance: "mocked",
    scannerVersion: options.scannerVersion ?? MOCK_SCANNER_VERSION,
    collectProcesses: async () => outcome,
  };
}

export function mockProcessRecord(overrides: Partial<RawProcessRecord> = {}): RawProcessRecord {
  return {
    processId: 4242,
    parentProcessId: 1000,
    processName: "demo-agent.exe",
    executablePath: "C:\\Demo\\demo-agent.exe",
    processStartTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function mockNormalizeContext(scanId: string = MOCK_SCAN_ID): NormalizeContext {
  return {
    scanId,
    collectionTimestamp: MOCK_COLLECTION_TIMESTAMP,
    source: "mocked",
  };
}
