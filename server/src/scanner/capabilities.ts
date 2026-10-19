import type {
  ExecutableMetadataCollector,
  ProcessInventoryCollector,
  ScannerCapabilities,
  ScannerCapabilityProvider,
  ScannerFeatureAvailability,
} from "./ports.ts";

export type CapabilityDetectionOptions = {
  platform?: string;
  processCollector?: ProcessInventoryCollector | null;
  executableCollector?: ExecutableMetadataCollector | null;
};

const ENGINE_MISSING_REASON = "Process collection engine is not implemented yet.";
const EXECUTABLE_REASON = "Executable metadata collection is not implemented yet.";
const HASH_REASON = "SHA-256 hashing is not implemented yet.";
const SIGNATURE_REASON = "Signature verification is not implemented yet.";

function availability(impl: unknown, reason: string): ScannerFeatureAvailability {
  return impl ? { available: true, reason: null } : { available: false, reason };
}

/**
 * Reports what the scanner can actually do right now, based on the platform
 * and the collectors that are genuinely registered. Nothing here collects
 * OS data; when no real collector is registered the capabilities are
 * reported as unavailable instead of simulated.
 */
export async function detectScannerCapabilities(
  options: CapabilityDetectionOptions = {},
): Promise<ScannerCapabilities> {
  const platform = options.platform ?? process.platform;
  const osSupported = platform === "win32";
  const processCollector = options.processCollector ?? null;
  const executableCollector = options.executableCollector ?? null;

  const limitations: string[] = [];
  if (!osSupported) {
    limitations.push(
      `Platform "${platform}" is not supported; the process inventory scanner targets Windows only.`,
    );
  }
  if (!processCollector) {
    limitations.push(`${ENGINE_MISSING_REASON} No real OS inventory can be collected.`);
  } else if (processCollector.provenance === "mocked") {
    limitations.push(
      "Mocked collector registered: any evidence produced is simulated test data, not real Windows inventory.",
    );
  } else {
    limitations.push(
      "Process inventory only: files, memory, registry, startup entries and network are not inspected.",
    );
  }
  if (!executableCollector) {
    limitations.push(`${EXECUTABLE_REASON} Hashes and signatures are not collected.`);
  }

  return {
    platform,
    osSupported,
    collectorProvenance: processCollector?.provenance ?? null,
    scannerVersion: processCollector?.scannerVersion ?? null,
    features: {
      processInventory: availability(processCollector, ENGINE_MISSING_REASON),
      executableMetadata: availability(executableCollector, EXECUTABLE_REASON),
      sha256Hashing: availability(executableCollector, HASH_REASON),
      signatureVerification: availability(executableCollector, SIGNATURE_REASON),
    },
    limitations,
  };
}

export function createCapabilityProvider(
  options: CapabilityDetectionOptions = {},
): ScannerCapabilityProvider {
  return {
    detectCapabilities: () => detectScannerCapabilities(options),
  };
}
