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

export const ROTATING_TEXT =
  "DYNIX TRACE • SAME GAME, A FAIRER TOMORROW • INTEGRITY CREATES BETTER GAMES • ";

export type Game = { id: string; name: string; hue: string };

export const GAMES: Game[] = [
  { id: "minecraft", name: "Minecraft.exe", hue: "#5d9c4a" },
  { id: "cod", name: "Call of Duty.exe", hue: "#7b8a99" },
  { id: "ff", name: "FreeFire.exe", hue: "#ff6b1a" },
  { id: "bgmi", name: "BGMI.exe", hue: "#c8a24a" },
  { id: "valorant", name: "Valorant.exe", hue: "#ff4655" },
];
