import type { ProcessEvidence } from "../contracts.ts";
import type { FindingDraft, FindingEvaluationInput, FindingRule } from "../ports.ts";

/**
 * Deterministic, evidence-only location classification. Every decision is
 * made from the observed executable path plus documented Windows defaults;
 * nothing here contacts the network or calls an AI model.
 */
export type ExecutablePathClass = "system" | "user-writable" | "temp" | "other";

export type PathOptions = {
  systemRoot?: string;
  userProfile?: string;
  tempRoots?: string[];
};

export type ResolvedPathOptions = {
  systemRoot: string | null;
  userProfile: string | null;
  tempRoots: string[];
};

function normalizePath(value: string): string {
  return value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * The evidence contract types `value` as `string | number | null` across all
 * field kinds; rules only ever treat path and name values as strings.
 */
export function observedString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolvePathOptions(options: PathOptions): ResolvedPathOptions {
  const systemRoot =
    options.systemRoot ?? process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const userProfile =
    options.userProfile !== undefined ? options.userProfile : (process.env.USERPROFILE ?? null);
  const explicitTempRoots = options.tempRoots ?? [
    process.env.TEMP ?? null,
    process.env.TMP ?? null,
    `${systemRoot}\\Temp`,
  ].filter((root): root is string => typeof root === "string" && root.length > 0);
  return { systemRoot, userProfile, tempRoots: explicitTempRoots };
}

function isUnder(normalizedPath: string, root: string | null): boolean {
  if (root === null || root.length === 0) {
    return false;
  }
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

/**
 * Classifies where an executable runs from:
 * - temp: any configured temp root, or an `\\AppData\\Local\\Temp\\` segment.
 * - user-writable: inside the user profile, under `\\Users\\Public\\` or
 *   under `\\ProgramData\\` — locations the current user can write to.
 * - system: under the Windows directory.
 * - other: anything else (for example Program Files, which is not
 *   user-writable by default).
 *
 * Temp wins over user-writable so temporary files are reported as such.
 */
export function classifyExecutablePath(
  rawPath: string,
  options: ResolvedPathOptions,
): ExecutablePathClass {
  const path = normalizePath(rawPath);
  if (path.length === 0) {
    return "other";
  }
  for (const root of options.tempRoots) {
    if (isUnder(path, root)) {
      return "temp";
    }
  }
  if (/\\appdata\\local\\temp(\\|$)/.test(path)) {
    return "temp";
  }
  if (isUnder(path, options.userProfile)) {
    return "user-writable";
  }
  if (/\\users\\public(\\|$)/.test(path) || /\\programdata(\\|$)/.test(path)) {
    return "user-writable";
  }
  if (isUnder(path, options.systemRoot)) {
    return "system";
  }
  return "other";
}

/** Core Windows binary names that essentially always run from system directories. */
export const SYSTEM_BINARY_NAMES: readonly string[] = [
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "winlogon.exe",
  "svchost.exe",
  "fontdrvhost.exe",
  "dwm.exe",
  "lsaiso.exe",
  "conhost.exe",
  "taskhostw.exe",
  "rundll32.exe",
  "spoolsv.exe",
  "explorer.exe",
];

function allowedRootsForSystemBinary(
  name: string,
  options: ResolvedPathOptions,
): string[] {
  const roots: string[] = [];
  if (options.systemRoot !== null) {
    roots.push(`${options.systemRoot}\\System32`, `${options.systemRoot}\\SysWOW64`);
    if (name === "explorer.exe") {
      roots.push(options.systemRoot);
    }
  }
  return roots;
}

type GroupedProcess = {
  path: string;
  name: string;
  evidenceIds: string[];
  pids: number[];
};

function groupByExecutablePath(
  processes: readonly ProcessEvidence[],
  select: (process: ProcessEvidence) => boolean,
): GroupedProcess[] {
  const groups = new Map<string, GroupedProcess>();
  for (const process of processes) {
    if (!select(process)) {
      continue;
    }
    const path = observedString(process.executablePath.value);
    const name = observedString(process.processName.value);
    if (path === null || name === null) {
      continue;
    }
    const key = normalizePath(path);
    const existing = groups.get(key);
    if (existing) {
      existing.evidenceIds.push(process.evidenceId);
      existing.pids.push(process.processId);
    } else {
      groups.set(key, {
        path,
        name,
        evidenceIds: [process.evidenceId],
        pids: [process.processId],
      });
    }
  }
  return [...groups.values()];
}

function referenceLabel(group: GroupedProcess): string {
  const pidList =
    group.pids.length > 5
      ? `${group.pids.slice(0, 5).join(", ")} +${group.pids.length - 5} more`
      : group.pids.join(", ");
  const label = `${group.name} · ${group.path} (PID ${pidList})`;
  return label.length > 200 ? `${label.slice(0, 197)}…` : label;
}

function referencesFor(group: GroupedProcess) {
  // One reference per unique executable path; the label carries the file
  // name, full path and the PIDs so the console can print the detail line.
  return [
    {
      kind: "executable" as const,
      refId: group.evidenceIds[0] ?? group.path,
      label: referenceLabel(group),
    },
  ];
}

const PATH_LIMITATION =
  "Paths, signatures and hashes describe the system at scan time; a process could have been started before the file on disk changed.";

export const MASQUERADING_RULE_ID = "masquerading-system-binary";
export const UNSIGNED_USER_LOCATION_RULE_ID = "unsigned-executable-user-location";
export const TEMP_LOCATION_RULE_ID = "executable-in-temp-location";

/**
 * R1 — a process whose name matches a core Windows binary is running from a
 * directory where that binary never normally lives. This is a classic
 * masquerading indicator; the finding states the observed location only.
 */
export function createMasqueradingBinaryRule(options: PathOptions = {}): FindingRule {
  return {
    id: MASQUERADING_RULE_ID,
    category: "process_metadata",
    evaluate({ processes }: FindingEvaluationInput): FindingDraft[] {
      const resolved = resolvePathOptions(options);
      const drafts: FindingDraft[] = [];
      const groups = groupByExecutablePath(processes, (process) => {
        const name = observedString(process.processName.value)?.toLowerCase() ?? null;
        return (
          name !== null &&
          SYSTEM_BINARY_NAMES.includes(name) &&
          observedString(process.executablePath.value) !== null
        );
      });
      for (const group of groups) {
        const name = group.name.toLowerCase();
        const allowed = allowedRootsForSystemBinary(name, resolved);
        const runsFromAllowed = allowed.some((root) => isUnder(normalizePath(group.path), root));
        if (runsFromAllowed) {
          continue;
        }
        drafts.push({
          category: "process_metadata",
          title: `System binary name from an unexpected location: ${group.name}`,
          description:
            `Process "${group.name}" is running from "${group.path}". ` +
            (allowed.length > 0
              ? `This name normally runs from ${allowed.map((root) => `"${root}"`).join(" or ")}. `
              : "") +
            "A process using a system binary name from another directory is a common masquerading pattern. " +
            "This finding states the observed name and location only; it is not by itself proof of malicious intent.",
          severity: "high",
          verificationStatus: "INFERRED",
          evidenceReferences: referencesFor(group),
          limitations: [
            PATH_LIMITATION,
            "The process name is taken from the process table; the on-disk file name was not re-verified against the running image.",
          ],
          alternativeExplanations: [
            "Portable or recovery copies of system tools can run from other directories without being malicious.",
            "A file can coincidentally share a name with a core Windows binary.",
          ],
        });
        if (drafts.length >= 100) {
          break;
        }
      }
      return drafts;
    },
  };
}

/**
 * R2 — an executable with an UNSIGNED or INVALID signature is running from a
 * user-writable location (including temp directories). High-probability
 * evidence: this is where cheat loaders and dropped payloads typically run.
 */
export function createUnsignedUserLocationRule(options: PathOptions = {}): FindingRule {
  return {
    id: UNSIGNED_USER_LOCATION_RULE_ID,
    category: "file_integrity",
    evaluate({ processes }: FindingEvaluationInput): FindingDraft[] {
      const resolved = resolvePathOptions(options);
      const drafts: FindingDraft[] = [];
      const groups = groupByExecutablePath(processes, (process) => {
        const status = process.executable?.signature.status;
        if (status !== "UNSIGNED" && status !== "INVALID") {
          return false;
        }
        const path = observedString(process.executablePath.value);
        if (path === null) {
          return false;
        }
        const locationClass = classifyExecutablePath(path, resolved);
        return locationClass === "user-writable" || locationClass === "temp";
      });
      for (const group of groups) {
        const locationClass = classifyExecutablePath(group.path, resolved);
        const source = processes.find((process) => process.evidenceId === group.evidenceIds[0]);
        const signatureStatus = source?.executable?.signature.status ?? "UNSIGNED";
        const method = source?.executable?.signature.method ?? "none";
        const statusWord = signatureStatus === "INVALID" ? "Invalidly signed" : "Unsigned";
        drafts.push({
          category: "file_integrity",
          title: `${statusWord} executable running from a ${locationClass === "temp" ? "temporary" : "user-writable"} location: ${group.name}`,
          description:
            `Executable "${group.name}" at "${group.path}" reports signature status ${signatureStatus} ` +
            `(checked with ${method}) and runs from a ${locationClass === "temp" ? "temporary directory" : "user-writable location"}. ` +
            "Unsigned or tampered executables running from user-writable locations are a common cheat-loader pattern, " +
            "but development builds, side-loaded apps and portable tools also run unsigned from these directories.",
          severity: "high",
          verificationStatus: method === "windows-authenticode" ? "VERIFIED" : "OBSERVED",
          evidenceReferences: referencesFor(group),
          limitations: [
            PATH_LIMITATION,
            "An unsigned binary is not necessarily malicious; intent cannot be read from a signature status.",
          ],
          alternativeExplanations: [
            "Locally built or portable applications legitimately run unsigned from user directories.",
            "Games, launchers and overlay tools distributed without code signing also match this pattern.",
          ],
        });
        if (drafts.length >= 100) {
          break;
        }
      }
      return drafts;
    },
  };
}

/**
 * R3 — any executable running from a temporary directory that was not
 * already flagged as unsigned or invalid by R2. Medium confidence: temp
 * execution is common for loaders but also for installers and updaters.
 */
export function createTempLocationRule(options: PathOptions = {}): FindingRule {
  return {
    id: TEMP_LOCATION_RULE_ID,
    category: "file_integrity",
    evaluate({ processes }: FindingEvaluationInput): FindingDraft[] {
      const resolved = resolvePathOptions(options);
      const drafts: FindingDraft[] = [];
      const groups = groupByExecutablePath(processes, (process) => {
        const path = observedString(process.executablePath.value);
        if (path === null) {
          return false;
        }
        const status = process.executable?.signature.status;
        if (status === "UNSIGNED" || status === "INVALID") {
          // Already reported as high-probability evidence by R2.
          return false;
        }
        return classifyExecutablePath(path, resolved) === "temp";
      });
      for (const group of groups) {
        drafts.push({
          category: "file_integrity",
          title: `Executable running from a temporary directory: ${group.name}`,
          description:
            `Executable "${group.name}" is running from "${group.path}", a temporary directory writable by the current user. ` +
            "Cheat loaders frequently execute from temp directories, but installers, updaters and self-extracting tools do as well.",
          severity: "medium",
          verificationStatus: "OBSERVED",
          evidenceReferences: referencesFor(group),
          limitations: [PATH_LIMITATION],
          alternativeExplanations: [
            "Installers and updaters commonly unpack and run from temp directories.",
            "Some applications execute helper binaries from the temp directory during normal operation.",
          ],
        });
        if (drafts.length >= 100) {
          break;
        }
      }
      return drafts;
    },
  };
}

/** The default rule set registered by the application. */
export function createDefaultFindingRules(options: PathOptions = {}): FindingRule[] {
  return [
    createMasqueradingBinaryRule(options),
    createUnsignedUserLocationRule(options),
    createTempLocationRule(options),
  ];
}

