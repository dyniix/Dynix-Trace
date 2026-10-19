import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ScannerEngineError } from "../src/scanner/engine-error.ts";
import type { PowerShellResult, PowerShellRunner } from "../src/scanner/windows/powershell.ts";
import { mapAuthenticodeStatus, createExecutableMetadataCollector } from "../src/scanner/windows/executable.ts";
import { createWindowsProcessCollector } from "../src/scanner/windows/collector.ts";
import { parseProcessQueryOutput } from "../src/scanner/windows/processes.ts";

function fakeRunner(result: PowerShellResult): PowerShellRunner {
  return {
    run: async () => result,
  };
}

const COLLECTION_CONTEXT = { now: () => "2026-01-01T00:00:00.000Z" };

test("the process query parser reads array and single-object JSON", () => {
  const arrayOutput = JSON.stringify([
    { pid: 0, ppid: 0, name: "System Idle Process", exe: null, started: null },
    { pid: 4, ppid: 0, name: "System", exe: null, started: null },
    {
      pid: 4242,
      ppid: 1000,
      name: "demo-agent.exe",
      exe: "C:\\Demo\\demo-agent.exe",
      started: "2026-01-01T00:00:00.000Z",
    },
  ]);
  const parsed = parseProcessQueryOutput(arrayOutput);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.records[0]?.fieldIssues?.executablePath, "NOT_APPLICABLE");
  assert.equal(parsed.records[1]?.fieldIssues?.executablePath, "NOT_APPLICABLE");
  assert.equal(parsed.records[2]?.executablePath, "C:\\Demo\\demo-agent.exe");
  assert.equal(parsed.records[2]?.fieldIssues, undefined);

  const singleOutput = JSON.stringify({
    pid: 7,
    ppid: 1,
    name: "solo.exe",
    exe: "C:\\solo.exe",
    started: null,
  });
  const single = parseProcessQueryOutput(singleOutput);
  assert.equal(single.records.length, 1);
  assert.equal(single.records[0]?.processId, 7);
});

test("a process without an accessible path is marked ACCESS_DENIED, not guessed", () => {
  const output = JSON.stringify([{ pid: 900, ppid: 4, name: "svc.exe", exe: null, started: null }]);
  const parsed = parseProcessQueryOutput(output);
  assert.equal(parsed.records[0]?.fieldIssues?.executablePath, "ACCESS_DENIED");
  assert.equal(parsed.records[0]?.executablePath, null);
});

test("invalid process entries are excluded with an aggregated warning", () => {
  const output = JSON.stringify([
    { pid: 10, ppid: 1, name: "ok.exe", exe: null, started: null },
    { pid: "not-a-number", ppid: 1, name: "bad.exe" },
    { name: "missing-pid.exe" },
  ]);
  const parsed = parseProcessQueryOutput(output);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings[0]?.code, "RAW_RECORD_INVALID");
  assert.equal(parsed.warnings[0]?.occurrences, 2);
});

test("empty or malformed query output is reported, never invented", () => {
  const empty = parseProcessQueryOutput("   ");
  assert.equal(empty.records.length, 0);
  assert.equal(empty.warnings[0]?.code, "RAW_RECORD_INVALID");

  const broken = parseProcessQueryOutput("{not json");
  assert.equal(broken.records.length, 0);
  assert.equal(broken.warnings[0]?.code, "RAW_RECORD_INVALID");
});

test("the Windows collector is labelled windows-native and parses a real-looking payload", async () => {
  const runner = fakeRunner({
    ok: true,
    durationMs: 12,
    stdout: JSON.stringify([
      { pid: 0, ppid: 0, name: "System Idle Process", exe: null, started: null },
      { pid: 4, ppid: 0, name: "System", exe: null, started: null },
    ]),
  });
  const collector = createWindowsProcessCollector(runner);
  assert.equal(collector.provenance, "windows-native");
  const outcome = await collector.collectProcesses(COLLECTION_CONTEXT);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.records.length, 2);
});

test("engine failures surface as explicit ScannerEngineError codes", async () => {
  const unavailable = createWindowsProcessCollector(
    fakeRunner({ ok: false, code: "PS_UNAVAILABLE", message: "no powershell", stderr: "" }),
  );
  await assert.rejects(
    () => unavailable.collectProcesses(COLLECTION_CONTEXT),
    (error: unknown) => error instanceof ScannerEngineError && error.code === "PS_UNAVAILABLE",
  );

  const timedOut = createWindowsProcessCollector(
    fakeRunner({ ok: false, code: "PS_TIMEOUT", message: "too slow", stderr: "" }),
  );
  await assert.rejects(
    () => timedOut.collectProcesses(COLLECTION_CONTEXT),
    (error: unknown) => error instanceof ScannerEngineError && error.code === "PS_TIMEOUT",
  );

  const emptyOutput = createWindowsProcessCollector(fakeRunner({ ok: true, durationMs: 5, stdout: "" }));
  await assert.rejects(
    () => emptyOutput.collectProcesses(COLLECTION_CONTEXT),
    (error: unknown) => error instanceof ScannerEngineError && error.code === "PROCESS_QUERY_FAILED",
  );
});

test("an already-cancelled scan aborts before any engine work", async () => {
  let called = false;
  const runner: PowerShellRunner = {
    run: async () => {
      called = true;
      return { ok: true, durationMs: 0, stdout: "[]" };
    },
  };
  const collector = createWindowsProcessCollector(runner);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => collector.collectProcesses({ signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(called, false);
});

test("Authenticode statuses map onto the honest signature vocabulary", () => {
  assert.equal(mapAuthenticodeStatus("Valid"), "VALID");
  assert.equal(mapAuthenticodeStatus("NotSigned"), "UNSIGNED");
  assert.equal(mapAuthenticodeStatus("HashMismatch"), "INVALID");
  assert.equal(mapAuthenticodeStatus("NotTrusted"), "UNKNOWN");
  assert.equal(mapAuthenticodeStatus("UnknownError"), "UNKNOWN");
  assert.equal(mapAuthenticodeStatus("weird-new-status"), "UNKNOWN");
});

test("executable metadata collection hashes a real file correctly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dynix-engine-test-"));
  try {
    const target = join(dir, "sample.bin");
    const content = Buffer.from("dynix-trace-part2-hash-check");
    writeFileSync(target, content);
    const expectedHash = createHash("sha256").update(content).digest("hex");

    const collector = createExecutableMetadataCollector(
      fakeRunner({ ok: true, durationMs: 5, stdout: '{"status":"NotSigned","subject":null}' }),
    );
    const outcome = await collector.collectExecutableMetadata({
      executablePath: target,
      context: COLLECTION_CONTEXT,
    });
    assert.equal(outcome.metadata?.sha256, expectedHash);
    assert.equal(outcome.metadata?.fileSizeBytes, content.length);
    assert.equal(outcome.metadata?.signatureStatus, "UNSIGNED");
    assert.equal(outcome.metadata?.signatureMethod, "windows-authenticode");
    assert.equal(outcome.metadata?.signerName, null);
    assert.equal(outcome.warnings.length, 0);
    assert.match(outcome.metadata?.createdAt ?? "", /Z$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("signature results without a usable signer stay honest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dynix-engine-test-"));
  try {
    const target = join(dir, "signed.bin");
    writeFileSync(target, "x");

    const valid = createExecutableMetadataCollector(
      fakeRunner({
        ok: true,
        durationMs: 5,
        stdout: '{"status":"Valid","subject":"CN=Demo Publisher, O=Demo"}',
      }),
    );
    const validOutcome = await valid.collectExecutableMetadata({
      executablePath: target,
      context: COLLECTION_CONTEXT,
    });
    assert.equal(validOutcome.metadata?.signatureStatus, "VALID");
    assert.equal(validOutcome.metadata?.signerName, "CN=Demo Publisher, O=Demo");

    const mismatch = createExecutableMetadataCollector(
      fakeRunner({ ok: true, durationMs: 5, stdout: '{"status":"HashMismatch","subject":"CN=X"}' }),
    );
    const mismatchOutcome = await mismatch.collectExecutableMetadata({
      executablePath: target,
      context: COLLECTION_CONTEXT,
    });
    assert.equal(mismatchOutcome.metadata?.signatureStatus, "INVALID");

    const unavailable = createExecutableMetadataCollector(
      fakeRunner({
        ok: false,
        code: "PS_UNAVAILABLE",
        message: "no powershell",
        stderr: "",
      }),
    );
    const unavailableOutcome = await unavailable.collectExecutableMetadata({
      executablePath: target,
      context: COLLECTION_CONTEXT,
    });
    assert.equal(unavailableOutcome.metadata?.signatureStatus, "UNAVAILABLE");
    assert.equal(unavailableOutcome.metadata?.signatureMethod, "none");
    assert.equal(
      unavailableOutcome.warnings.some((item) => item.code === "SIGNATURE_CHECK_UNAVAILABLE"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file yields access-status field issues instead of fake metadata", async () => {
  const collector = createExecutableMetadataCollector(
    fakeRunner({ ok: true, durationMs: 5, stdout: '{"status":"Error","subject":null}' }),
  );
  const outcome = await collector.collectExecutableMetadata({
    executablePath: join(tmpdir(), "dynix-does-not-exist-12345.exe"),
    context: COLLECTION_CONTEXT,
  });
  assert.equal(outcome.metadata?.fileSizeBytes, null);
  assert.equal(outcome.metadata?.fieldIssues?.fileSizeBytes, "UNAVAILABLE");
  assert.equal(outcome.metadata?.fieldIssues?.sha256, "UNAVAILABLE");
  assert.equal(
    outcome.warnings.some((item) => item.code === "HASH_FAILED"),
    true,
  );
});
