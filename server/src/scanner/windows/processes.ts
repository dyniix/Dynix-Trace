import type { RawProcessRecord } from "../ports.ts";
import type { ScanWarning } from "../contracts.ts";

export const PROCESS_QUERY_TIMEOUT_MS = 45000;

export const PROCESS_QUERY_SCRIPT = `
$rows = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object {
  $ppid = $null
  if ($null -ne $_.ParentProcessId) { $ppid = [int]$_.ParentProcessId }
  $started = $null
  if ($_.CreationDate) { $started = $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = $ppid
    name = $_.Name
    exe = $_.ExecutablePath
    started = $started
  }
})
if ($rows.Count -eq 0) { Write-Output '[]' } else { $rows | ConvertTo-Json -Compress -Depth 3 }
`.trim();

type RawProcessJsonEntry = {
  pid?: unknown;
  ppid?: unknown;
  name?: unknown;
  exe?: unknown;
  started?: unknown;
};

function asIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

/**
 * Windows returns no ExecutablePath for processes the current user may not
 * inspect (commonly elevated processes), and the two kernel pseudo-processes
 * (System Idle PID 0, System PID 4) have no image path at all.
 */
function executablePathIssue(processId: number): "ACCESS_DENIED" | "NOT_APPLICABLE" {
  return processId <= 4 ? "NOT_APPLICABLE" : "ACCESS_DENIED";
}

export function parseProcessQueryOutput(stdout: string): {
  records: RawProcessRecord[];
  warnings: ScanWarning[];
} {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return {
      records: [],
      warnings: [
        {
          code: "RAW_RECORD_INVALID",
          message: "The process query returned no output.",
          occurrences: 1,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      records: [],
      warnings: [
        {
          code: "RAW_RECORD_INVALID",
          message: "The process query output was not valid JSON.",
          occurrences: 1,
        },
      ],
    };
  }

  const entries: RawProcessJsonEntry[] = Array.isArray(parsed)
    ? (parsed as RawProcessJsonEntry[])
    : typeof parsed === "object" && parsed !== null
      ? [parsed as RawProcessJsonEntry]
      : [];

  const records: RawProcessRecord[] = [];
  let invalid = 0;
  for (const entry of entries) {
    const processId = asIntOrNull(entry.pid);
    if (processId === null || processId < 0) {
      invalid += 1;
      continue;
    }
    const executablePath = asStringOrNull(entry.exe);
    records.push({
      processId,
      parentProcessId: asIntOrNull(entry.ppid),
      processName: asStringOrNull(entry.name),
      executablePath,
      processStartTime: asStringOrNull(entry.started),
      ...(executablePath === null
        ? { fieldIssues: { executablePath: executablePathIssue(processId) } }
        : {}),
    });
  }

  const warnings: ScanWarning[] = [];
  if (invalid > 0) {
    warnings.push({
      code: "RAW_RECORD_INVALID",
      message: `${invalid} process entries without a valid process ID were excluded from the inventory.`,
      occurrences: invalid,
    });
  }
  return { records, warnings };
}
