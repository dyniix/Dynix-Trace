import { ScannerEngineError } from "../engine-error.ts";
import type { ProcessInventoryCollector } from "../ports.ts";
import { PROCESS_QUERY_SCRIPT, PROCESS_QUERY_TIMEOUT_MS, parseProcessQueryOutput } from "./processes.ts";
import { createPowerShellRunner, type PowerShellRunner } from "./powershell.ts";

export const WINDOWS_SCANNER_VERSION = "0.1.0";

/**
 * Read-only Windows process inventory via a fixed `Win32_Process` CIM query.
 * Does not run arbitrary commands, does not inspect process memory, and does
 * not require administrator rights — processes the current user may not
 * inspect simply come back with access statuses instead of data.
 */
export function createWindowsProcessCollector(
  runner: PowerShellRunner = createPowerShellRunner(),
): ProcessInventoryCollector {
  return {
    provenance: "windows-native",
    scannerVersion: WINDOWS_SCANNER_VERSION,
    async collectProcesses(context) {
      if (context.signal?.aborted) {
        const abort = new Error("The scan was cancelled.");
        abort.name = "AbortError";
        throw abort;
      }
      const result = await runner.run(PROCESS_QUERY_SCRIPT, {
        timeoutMs: PROCESS_QUERY_TIMEOUT_MS,
        signal: context.signal,
      });
      if (!result.ok) {
        throw new ScannerEngineError(result.code, result.message);
      }
      const { records, warnings } = parseProcessQueryOutput(result.stdout);
      if (records.length === 0 && warnings.length > 0) {
        throw new ScannerEngineError(
          "PROCESS_QUERY_FAILED",
          "The Windows process query returned no usable records.",
        );
      }
      return {
        records,
        attempted: records.length,
        completed: records.length,
        complete: true,
        warnings,
        limitations: [],
      };
    },
  };
}
