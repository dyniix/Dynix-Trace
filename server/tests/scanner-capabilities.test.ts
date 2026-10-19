import assert from "node:assert/strict";
import { test } from "node:test";
import { createCapabilityProvider, detectScannerCapabilities } from "../src/scanner/capabilities.ts";
import { createMockProcessCollector, mockProcessRecord } from "./support/scanner-mocks.ts";

test("without an engine the scanner reports itself honestly unavailable", async () => {
  const capabilities = await detectScannerCapabilities();
  assert.equal(capabilities.platform, process.platform);
  assert.equal(capabilities.osSupported, process.platform === "win32");
  assert.equal(capabilities.collectorProvenance, null);
  assert.equal(capabilities.features.processInventory.available, false);
  assert.match(
    capabilities.features.processInventory.reason ?? "",
    /not implemented yet/i,
  );
  assert.equal(capabilities.features.sha256Hashing.available, false);
  assert.equal(capabilities.features.signatureVerification.available, false);
  assert.equal(
    capabilities.limitations.some((item) => item.includes("not implemented yet")),
    true,
  );
});

test("a mocked collector is reported as mocked, never as real Windows collection", async () => {
  const collector = createMockProcessCollector([mockProcessRecord()]);
  const capabilities = await detectScannerCapabilities({ processCollector: collector });
  assert.equal(capabilities.features.processInventory.available, true);
  assert.equal(capabilities.collectorProvenance, "mocked");
  assert.equal(capabilities.scannerVersion, "mock-0.0.0");
  assert.notEqual(capabilities.collectorProvenance, "windows-native");
  assert.equal(
    capabilities.limitations.some((item) => item.includes("simulated test data")),
    true,
  );
});

test("unsupported platforms are reported without pretending to scan", async () => {
  const capabilities = await detectScannerCapabilities({ platform: "linux" });
  assert.equal(capabilities.osSupported, false);
  assert.equal(capabilities.features.processInventory.available, false);
  assert.equal(
    capabilities.limitations.some((item) => item.includes("linux")),
    true,
  );
});

test("the capability provider exposes the same honest detection through the port", async () => {
  const provider = createCapabilityProvider();
  const capabilities = await provider.detectCapabilities();
  assert.equal(typeof capabilities.platform, "string");
  assert.equal(capabilities.features.processInventory.available, false);
});
