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
  primary: "Initiate Trace",
  primaryActive: "Tracing…",
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
export const MONITOR_NOTE = "Preview build — tracing is simulated";

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
