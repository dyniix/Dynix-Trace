import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type PowerShellOk = { ok: true; stdout: string; durationMs: number };
export type PowerShellFailure = {
  ok: false;
  code: "PS_UNAVAILABLE" | "PS_TIMEOUT" | "PS_FAILED";
  message: string;
  stderr: string;
};
export type PowerShellResult = PowerShellOk | PowerShellFailure;

export type PowerShellRunOptions = {
  timeoutMs: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
};

export interface PowerShellRunner {
  run(script: string, options: PowerShellRunOptions): Promise<PowerShellResult>;
}

const UTF8_PREAMBLE =
  "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function resolvePowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (systemRoot) {
    const candidate = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "powershell.exe";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Runs a fixed, compile-time PowerShell script. The script text is never
 * built from user input; dynamic values reach scripts only through
 * environment variables, which the shell does not interpolate. Read-only:
 * no script may modify files, processes, or system settings.
 */
export function createPowerShellRunner(powershellPath?: string): PowerShellRunner {
  const executablePath = powershellPath ?? resolvePowerShellPath();
  return {
    run(script, options) {
      const startedAt = Date.now();
      return new Promise<PowerShellResult>((resolve, reject) => {
        if (options.signal?.aborted) {
          const abort = new Error("The scan was cancelled.");
          abort.name = "AbortError";
          reject(abort);
          return;
        }
        execFile(
          executablePath,
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            UTF8_PREAMBLE + script,
          ],
          {
            timeout: options.timeoutMs,
            signal: options.signal,
            windowsHide: true,
            maxBuffer: MAX_OUTPUT_BYTES,
            env: { ...process.env, ...options.env },
          },
          (error, stdout, stderr) => {
            const durationMs = Date.now() - startedAt;
            if (error) {
              if (isAbortError(error)) {
                reject(error);
                return;
              }
              const execError = error as NodeJS.ErrnoException & { killed?: boolean };
              if (execError.code === "ENOENT") {
                resolve({
                  ok: false,
                  code: "PS_UNAVAILABLE",
                  message:
                    "Windows PowerShell is not available, so this machine cannot be inspected.",
                  stderr: "",
                });
                return;
              }
              if (execError.killed === true || execError.code === "ETIMEDOUT") {
                resolve({
                  ok: false,
                  code: "PS_TIMEOUT",
                  message: `The inspection command did not finish within ${options.timeoutMs} ms.`,
                  stderr: stderr.slice(0, 500),
                });
                return;
              }
              resolve({
                ok: false,
                code: "PS_FAILED",
                message: "The inspection command failed.",
                stderr: stderr.slice(0, 500),
              });
              return;
            }
            resolve({ ok: true, stdout, durationMs });
          },
        );
      });
    },
  };
}
