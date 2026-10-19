export const BRAND = "DYNIX";
export const BRAND_SUB = "TRACE";
export const BRAND_LINE = "SCAN · TRACE · REVEAL";
export const VERSION = "v1.0.0";

export const NAV_LINKS = [
  { label: "Console", href: "#console" },
  { label: "Evidence", href: "#evidence" },
  { label: "Docs", href: "#docs" },
] as const;

export const HERO_KICKER = "Every match leaves a signal.";

export const HERO_LINES = ["Reveal", "the truth."] as const;

export const HERO_PARAGRAPH =
  "DYNIX TRACE is an integrity console for competitive gaming. It reads the signal under the noise of every match, links what doesn't belong, and turns it into evidence. No accusations — just traces.";

export const CTAS = {
  secondary: "Explore Console",
  primary: "Initiate Scan",
  primaryActive: "Tracing…",
  primaryError: "Could not start the trace — is the local backend running?",
} as const;

export const STATUS = {
  idle: "Online",
  active: "Scanning",
} as const;

export const CORNER_STATUS = {
  idle: "SIGNAL INTEGRITY 100%",
  active: "TRACING SIGNAL…",
} as const;

export const MONITOR_LABEL = "Live session feed";
export const MONITOR_NOTE = "Tracing runs locally — real process data, never leaves this machine";

export const ROTATING_TEXT =
  "DYNIX TRACE • SAME GAME, A FAIRER TOMORROW • INTEGRITY CREATES BETTER GAMES • ";

export type Game = {
  id: string;
  name: string;
  hue: string;
  label: string;
  icon: string;
  iconClassName?: string;
  order: number;
};

export const GAMES: Game[] = [
  {
    id: "minecraft",
    name: "Minecraft.exe",
    hue: "#5d9c4a",
    label: "Minecraft",
    icon: "/games/minecraft.png",
    order: 5,
  },
  {
    id: "cod",
    name: "Call of Duty.exe",
    hue: "#7b8a99",
    label: "Call of Duty",
    icon: "/games/call-of-duty.png",
    iconClassName: "saturate-[1.15]",
    order: 4,
  },
  {
    id: "ff",
    name: "FreeFire.exe",
    hue: "#ff6b1a",
    label: "Free Fire",
    icon: "/games/free-fire.png",
    order: 2,
  },
  {
    id: "bgmi",
    name: "BGMI.exe",
    hue: "#c8a24a",
    label: "BGMI",
    icon: "/games/bgmi.png",
    order: 3,
  },
  {
    id: "valorant",
    name: "Valorant.exe",
    hue: "#ff4655",
    label: "Valorant",
    icon: "/games/valorant.png",
    order: 1,
  },
];

export const TARGET_MODAL = {
  kicker: "DYNIX TRACE — TARGET SELECTION",
  title: "Select Target",
  subtitle: "Choose the game you want to inspect.",
  listLabel: "Game targets",
  summaryLabel: "Selected target",
  emptyHint: "Select a game to continue",
  confirm: "Continue",
  cancel: "Cancel",
  close: "Close target selection",
} as const;

export const CONSOLE = {
  kicker: "DYNIX TRACE — SYSTEM CONSOLE",
  title: "Trace Console",
  subtitle:
    "Live trace of this machine's running processes. Steps stream from the local backend as they happen — red lines mark high-probability evidence.",
  back: "Back to home",
  scopeNote: "Scope: running processes only — this is not a full-machine scan.",
  refresh: "Refresh",
  reload: "Reload",

  terminalTitle: "dynix-trace — process inventory",
  terminalIdle: "no scans recorded yet — start the first trace from the home screen.",
  terminalWaiting: "waiting for the first backend step…",
  terminalLoading: "loading feed…",
  terminalEmpty: "no feed was recorded for this scan.",
  terminalBusy: "tracing — steps appear as they happen…",

  viewReport: "View report",
  autoOpenNote: "opening report…",

  platformLabel: "Platform",
  sourceLabel: "Source",
  sourceNative: "Windows native",
  sourceMocked: "Simulated (test)",
  featureLabels: {
    processInventory: "Process inventory",
    executableMetadata: "Executable metadata",
    sha256Hashing: "SHA-256 hashing",
    signatureVerification: "Signature verification",
  },
  featureAvailable: "Available",
  featureUnavailable: "Unavailable",

  offlineTitle: "Backend offline",
  offlineBody:
    "The local backend is not reachable. Start it with npm run dev inside the server/ directory, then retry.",
  unavailableTitle: "Scanner unavailable",
  unavailableBody: "This platform cannot collect process inventory.",
  invalidTitle: "Unexpected backend response",
  invalidBody: "The backend replied in a shape the console cannot read. Retry, or check the backend logs.",
  statusOnline: "Backend online",
  statusConnecting: "Connecting",
  statusError: "Backend error",
  retry: "Retry",

  scanIdLabel: "Scan ID",
  processCountLabel: "proc",
  findingsCountLabel: "findings",
  warningsLabel: "Warnings",
  limitationsLabel: "Limitations",
  failureLabel: "Failure",
  stageLabel: "Stage",

  cancel: "Cancel scan",
  cancelArmed: "Confirm cancel",
  cancelBusy: "Cancelling…",
  cancelIdleNote: "Cancelling stops the running scan; recorded evidence stays in history.",

  pollDegradedNote: "Live updates paused — backend unreachable. The scan itself keeps running on the backend.",
  feedDegradedNote: "Feed paused — backend unreachable. The scan itself keeps running on the backend.",
  reconnect: "Reconnect",

  inventoryLabel: "Process inventory",
  inventoryEmpty: "No process records were persisted for this scan.",
  inventoryLoadFailed: "Could not load process inventory.",
  findingsLabel: "Findings",
  findingsEmpty: "No findings — the current ruleset found nothing suspicious in the recorded evidence.",
  findingsLoadFailed: "Could not load findings.",

  pickerLabel: "Recent scans",
  pickerPlaceholder: "Select a scan…",
  pickerEmpty: "No scans yet",
  pickerLoading: "Loading scans…",
  historyLoadFailed: "Could not load scan history.",
  noScansBody:
    "Scans start from the home screen — pick a target there and this console opens with the live feed.",
  noScansCta: "Initiate scan",

  pagerShowing: (from: number, to: number, total: number) => `Rows ${from}–${to} of ${total}`,
  pagerPrev: "Previous",
  pagerNext: "Next",
  pagerPage: (page: number) => `Page ${page}`,

  detailToggle: "Toggle row details",
  detailParentPid: "Parent PID",
  detailStartTime: "Started",
  detailEvidenceId: "Evidence ID",
  detailFilePath: "File path",
  detailFileSize: "File size",
  detailCreated: "Created",
  detailModified: "Modified",
  detailSha256: "SHA-256",
  detailSignatureMethod: "Signature method",
  detailSigner: "Signer",
  detailCollection: "Collected at",
  noneNote: "—",
} as const;

export const EVIDENCE = {
  kicker: "DYNIX TRACE — SCAN EVIDENCE",
  title: "Evidence Browser",
  subtitle:
    "One recorded trace, fully opened: integrity risk, evidence summary, findings, and the process inventory behind them.",
  back: "Back to console",
  browserLabel: "Evidence browser",
  pickerLabel: "Recorded scan",
  pickerPlaceholder: "Select a scan…",
  pickerLoading: "Loading scans…",
  pickerEmpty: "No scans recorded",
  pickerUnavailable: "History unavailable",
  listLabel: "Recorded scans",
  listEmpty: "No scans recorded yet. Start the first trace from the home screen.",
  listLoadFailed: "Could not load scan history.",
  newScan: "Initiate scan",
  loading: "Loading evidence…",
  loadFailed: "Could not load this report.",
  notFoundTitle: "Scan not found",
  notFoundBody: "This scan does not exist on the local backend.",
  retry: "Retry",
  generatedLabel: "Generated",
  reportFor: "Report for",

  metaLabel: "Trace metadata",
  metaStarted: "Started",
  metaDuration: "Duration",
  metaProcesses: "Processes",
  metaFindings: "Findings",

  riskLabel: "Integrity risk",
  riskBasis:
    "Heuristic score from recorded evidence — not a verdict. Findings are signals for human review.",
  factorsLabel: "Score factors",
  factorOccurrences: (count: number) => `×${count}`,
  factorPoints: (points: number) => `+${points}`,
  noFactors: "No risk factors — nothing suspicious was recorded.",
  runningNote: "This scan is still running — results keep settling until it completes.",
  runningCta: "Watch live in console",

  statsLabel: "Evidence summary",
  statEvidence: "Evidence records",
  statSignatures: "Signatures",
  statHashes: "SHA-256 coverage",
  statPaths: "Path classes",
  sigValid: "Signed",
  sigUnsigned: "Unsigned",
  sigInvalid: "Invalid",
  sigUnknown: "Unknown",
  sigUnavailable: "Unavailable",
  sigNotChecked: "Not checked",
  hashPresent: "Hashed",
  hashMissing: "Missing",
  pathSystem: "System",
  pathUser: "User-writable",
  pathTemp: "Temp",
  pathOther: "Other",
  pathUnknown: "No path",
  evidenceTruncated: "Evidence set was truncated for this report.",

  exportJson: "Download JSON",
  exportCopy: "Copy JSON",
  copied: "Copied",
  copyFailed: "Copy failed",
} as const;

export const DOCS = {
  kicker: "DYNIX TRACE — DOCUMENTATION",
  title: "Docs",
  subtitle:
    "The project README on one page: what the trace does, how a scan flows from the process table to the report, and the limits it never hides.",
  back: "Back to home",
  openConsole: "Open console",
  readmeLabel: "README · workflow",

  overviewLabel: "Overview",
  overview: [
    "DYNIX TRACE is an integrity console for competitive gaming — a branding concept. It never touches a game process, never injects and never modifies anything: it reads the process table of this machine and turns what it finds into evidence.",
    "Everything shown is real data from the local backend. No result is simulated, no finding is invented, and no percentage is guessed — progress is a stage, never a fabricated percent.",
  ],

  flowLabel: "Scan workflow",
  flowNote: "Six stages, one pipeline",
  flow: [
    {
      title: "Start",
      body: "The console requests a scan from the local backend. The request is strictly empty — no commands, no paths, nothing to inject.",
    },
    {
      title: "Collect",
      body: "A windows-native collector enumerates the running processes through a read-only CIM query (Win32_Process).",
    },
    {
      title: "Normalize",
      body: "Raw records become typed evidence. Missing values stay UNKNOWN — nothing is guessed or silently filled in.",
    },
    {
      title: "Inspect",
      body: "Every unique executable is hashed once (SHA-256) and checked against Windows Authenticode signatures.",
    },
    {
      title: "Rules",
      body: "Three deterministic rules review the evidence and raise findings — each one carries its evidence references.",
    },
    {
      title: "Report",
      body: "A capped heuristic score and honest statistics become the report — viewable, downloadable, and copyable as JSON.",
    },
  ],

  rulesLabel: "Detection rules",
  rules: [
    {
      id: "R1",
      name: "Masquerading system binary",
      severity: "High",
      points: "25 pts · cap 50",
      body: "A core Windows binary name (svchost.exe, lsass.exe, …) running from outside its real system directory.",
    },
    {
      id: "R2",
      name: "Unsigned in user-writable location",
      severity: "High",
      points: "12 pts · cap 48",
      body: "An UNSIGNED or INVALID executable running from a user-writable or temp directory.",
    },
    {
      id: "R3",
      name: "Executable in temp",
      severity: "Medium",
      points: "4 pts · cap 12",
      body: "Any other executable running from a temp directory — installers and updaters land there too.",
    },
  ],

  bandsLabel: "Risk bands",
  bands: [
    { label: "Low", range: "0–14" },
    { label: "Moderate", range: "15–39" },
    { label: "Elevated", range: "40–69" },
    { label: "High", range: "70–100" },
  ],

  stackLabel: "Stack",
  stack: "React 19 · Vite 8 · TypeScript · Tailwind CSS v4 · motion — Fastify 5 · node:sqlite · zod",

  apiLabel: "Local API",
  api: [
    { method: "GET", path: "/api/scanner/scans/:id/events", note: "Console feed, cursor-based" },
    { method: "GET", path: "/api/scanner/scans/:id/report", note: "Risk, findings, statistics" },
  ],

  limitsLabel: "Honest limits",
  limits: [
    "Running processes only — this is not a full-machine scan.",
    "Paths, hashes and signatures describe the system at scan time.",
    "Unsigned or temp execution is not proof of cheating — findings are signals for human review.",
    "The score is a heuristic, not a verdict.",
    "The backend is local and loopback-only — scan data never leaves this machine.",
  ],

  footer: "Loopback-only backend · findings need human review",
} as const;

export const AI_CONFIG = {
  trigger: "AI ACTIVE",
  kicker: "DYNIX TRACE — AI CONFIGURATION",
  title: "AI Configuration",
  subtitle:
    "Connect a model provider for future analysis. Credentials are stored by the local backend on this machine — never in the browser.",
  close: "Close AI configuration",
  providerLabel: "Provider",
  baseUrlLabel: "Base URL",
  baseUrlPlaceholder: "https://api.openai.com/v1",
  modelLabel: "Model",
  modelPlaceholder: "gpt-4o-mini",
  apiKeyLabel: "API key",
  apiKeyPlaceholder: "Paste the provider API key",
  apiKeyKeepPlaceholder: "Leave empty to keep the saved key",
  apiKeyStoredNote: "A key is saved on this machine — the current value is never shown.",
  loadingNote: "Loading configuration…",
  testingNote: "Testing connection…",
  idleNote: "Saved on the local backend only — never in the browser.",
  savedNote: "Configuration saved to the local backend.",
  savingNote: "Saving configuration…",
  resetNote: "Configuration removed from the local backend.",
  summaryLabel: "Config status",
  keySaved: "key saved",
  noKey: "no key",
  emptyHint: "Not configured yet",
  test: "Test Connection",
  reset: "Reset",
  resetConfirm: "Confirm reset",
  resetConfirmNote: "Click again to erase the stored configuration from this machine.",
  save: "Save Configuration",
  showKey: "Show API key",
  hideKey: "Hide API key",
  connectionLabel: "Connection status",
  connectionNotConnected: "Not connected",
  connectionTesting: "Testing connection",
  connectionConnected: "Connected",
  connectionFailed: "Connection failed",
  advancedLabel: "Advanced",
  timeoutLabel: "Request timeout (seconds)",
  timeoutHint: "1–60 seconds. Used for the next connection test and future AI requests.",
  maxRetriesLabel: "Max retries",
  maxRetriesHint: "0–5. Retries only transient network failures, never HTTP errors.",
  organizationLabel: "Organization / project ID",
  organizationPlaceholder: "org-… (optional)",
  organizationHint: "Optional. Sent as OpenAI-Organization for OpenAI-compatible providers.",
  invalidBaseUrl: "Base URL must start with http:// or https://.",
  invalidTimeout: "Request timeout must be between 1 and 60 seconds.",
  invalidRetries: "Max retries must be a whole number between 0 and 5.",
} as const;
