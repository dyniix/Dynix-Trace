import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { processEvidenceSchema } from "../src/scanner/contracts.ts";
import { normalizeCollection } from "../src/scanner/normalize.ts";
import { createWindowsProcessCollector } from "../src/scanner/windows/collector.ts";
import { createExecutableMetadataCollector } from "../src/scanner/windows/executable.ts";
import { createPowerShellRunner } from "../src/scanner/windows/powershell.ts";

const onWindows = process.platform === "win32";

function powershellExePath(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

test(
  "the real Windows collector returns this machine's live process inventory",
  { skip: !onWindows },
  async () => {
    const collector = createWindowsProcessCollector(createPowerShellRunner());
    const outcome = await collector.collectProcesses({});
    assert.equal(outcome.complete, true);
    assert.equal(outcome.attempted, outcome.records.length);
    assert.ok(outcome.records.length >= 2, "expected at least the two kernel pseudo-processes");

    const ids = new Set(outcome.records.map((record) => record.processId));
    assert.equal(ids.has(0), true, "expected the System Idle pseudo-process");
    assert.equal(ids.has(4), true, "expected the System pseudo-process");
    assert.equal(ids.has(process.pid), true, "expected this test runner's own process");

    const own = outcome.records.find((record) => record.processId === process.pid);
    assert.ok(own);
    assert.equal(typeof own.processName, "string");
    assert.ok((own.processName ?? "").length > 0);
  },
);

test(
  "real evidence is stamped windows-native and passes the evidence contract",
  { skip: !onWindows },
  async () => {
    const collector = createWindowsProcessCollector(createPowerShellRunner());
    const outcome = await collector.collectProcesses({});
    const normalized = normalizeCollection(outcome, {
      scanId: "scan-integration-1",
      collectionTimestamp: new Date().toISOString(),
      source: "windows-native",
    });
    assert.equal(normalized.processes.length, outcome.records.length);
    for (const evidence of normalized.processes) {
      assert.equal(evidence.source, "windows-native");
      assert.equal(processEvidenceSchema.safeParse(evidence).success, true);
    }
    const own = normalized.processes.find((evidence) => evidence.processId === process.pid);
    assert.ok(own);
    assert.equal(own.evidenceId, `scan-integration-1:proc:${process.pid}`);
    assert.equal(own.executablePath.status, "OBSERVED");
  },
);

test(
  "a real local file is hashed correctly and reported as unsigned",
  { skip: !onWindows },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "dynix-integration-"));
    try {
      const target = join(dir, "integration-sample.txt");
      const content = Buffer.from("dynix-trace windows integration");
      writeFileSync(target, content);
      const expectedHash = createHash("sha256").update(content).digest("hex");

      const collector = createExecutableMetadataCollector(createPowerShellRunner());
      const outcome = await collector.collectExecutableMetadata({
        executablePath: target,
        context: {},
      });
      assert.equal(outcome.metadata?.sha256, expectedHash);
      assert.equal(outcome.metadata?.fileSizeBytes, content.length);
      assert.equal(outcome.metadata?.signatureMethod, "windows-authenticode");
      // Authenticode cannot carry a signature on a non-PE file, so Windows
      // reports it as unsigned or undeterminable. Both are honest; claiming
      // VALID/INVALID here would be the bug.
      const status = outcome.metadata?.signatureStatus;
      assert.ok(
        status === "UNSIGNED" || status === "UNKNOWN",
        `unexpected status ${status} for a non-PE file`,
      );
      assert.equal(outcome.metadata?.signerName, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a real system executable is verified through Windows Authenticode",
  { skip: !onWindows || !existsSync(powershellExePath()) },
  async () => {
    const collector = createExecutableMetadataCollector(createPowerShellRunner());
    const outcome = await collector.collectExecutableMetadata({
      executablePath: powershellExePath(),
      context: {},
    });
    assert.equal(outcome.metadata?.signatureMethod, "windows-authenticode");
    const status = outcome.metadata?.signatureStatus;
    assert.ok(status === "VALID" || status === "UNKNOWN" || status === "INVALID", `unexpected status ${status}`);
    if (status === "VALID") {
      assert.ok((outcome.metadata?.signerName ?? "").length > 0, "a VALID signature must name its signer");
    }
    assert.equal((outcome.metadata?.sha256 ?? "").length, 64);
  },
);
