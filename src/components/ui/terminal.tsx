import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { createTerminalSpriteSfx } from "@/components/ui/terminal-utils/sprite-audio";

export type TerminalTheme = "carbon" | "midnight" | "paper";

export type TerminalLine =
  | { kind: "input"; text: string }
  | {
      kind: "output";
      text: string;
      tone?: "muted" | "success" | "warning" | "error" | "info";
    }
  | {
      kind: "progress";
      label: string;
      value: number;
      tone?: "info" | "success";
    }
  | { kind: "spinner"; text: string; tone?: "muted" | "info" };

export type TerminalCommand = {
  /** Command string (without prompt). */
  input: string;
  /** Optional output lines to reveal after the command. */
  output?: Array<
    string | Omit<Extract<TerminalLine, { kind: "output" }>, "kind">
  >;
  /** Optional simulated work time before outputs start (ms). */
  runDelayMs?: number;
};

export type TerminalProps = {
  /** Commands to type and run sequentially (script mode). */
  commands?: TerminalCommand[];
  /**
   * Live feed lines. When provided, the component renders exactly these
   * lines and skips the script engine entirely — used by the trace console
   * to mirror backend steps as they happen.
   */
  lines?: TerminalLine[];
  /** Live mode: render a spinner line at the end of the feed while true. */
  busy?: boolean;
  /** Live mode: spinner line text. */
  busyText?: string;
  /** Visual prompt (e.g. "➜"). */
  promptSymbol?: string;
  /** Username shown in the prompt. */
  username?: string;
  /** Hostname shown in the prompt. */
  hostname?: string;
  /** Header title line. */
  title?: string;
  /** Typing speed in ms per character. */
  typingSpeed?: number;
  /** Randomness added to typing cadence (ms). */
  typingJitter?: number;
  /** Initial delay before starting (ms). */
  startupDelay?: number;
  /** Delay after a command finishes before next begins (ms). */
  delayBetweenCommands?: number;
  /** Auto-start when component becomes visible (script mode only). */
  autoStart?: boolean;
  /** Loop the script forever. */
  loop?: boolean;
  /** Delay between loops (ms). */
  loopDelay?: number;
  /** Show blinking cursor. */
  showCursor?: boolean;
  /** Enable key/enter sound effects. */
  enableSound?: boolean;
  /**
   * URL of the OGG sprite for keyboard sounds.
   * The shipped sprite player is silent; audio assets are not bundled.
   */
  soundSpriteUrl?: string;
  /** JSON timing map for the sprite. */
  soundSpriteConfigUrl?: string;
  /** URL of a single audio file to play on every keypress. */
  simpleSoundUrl?: string;
  /** Show sound toggle button in the header. */
  showSoundToggle?: boolean;
  /** Show pause/resume controls (script mode only). */
  showControls?: boolean;
  /** Terminal theme variant (`paper` = light chrome). */
  theme?: TerminalTheme;
  /** When the parent gives a fixed height (`h-[…] flex flex-col`), set true so the body scrolls inside it. */
  fillHeight?: boolean;
  className?: string;
};

type RunState = "idle" | "running" | "paused" | "done";

function useInViewport<T extends HTMLElement>(opts?: IntersectionObserverInit) {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setInView(true);
      },
      { root: null, threshold: 0.35, ...opts },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [opts]);

  return { ref, inView } as const;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function tokenizeBash(input: string) {
  // Small, non-exhaustive tokenizer for "premium" feeling without pretending to be a full parser.
  const parts: Array<{ text: string; tone: string }> = [];
  const push = (text: string, tone: string) => {
    if (!text) return;
    parts.push({ text, tone });
  };

  const tokens = input.match(
    /(--?[A-Za-z0-9:_-]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\|\||&&|\||>|\$\w+|~\/[^\s]*|\.{1,2}\/\S*|\/[^\s]*|[A-Za-z]:\\[^\s]*|\S+|\s+)/g,
  ) ?? [input];

  let isFirstWord = true;
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      push(tok, "dim");
      continue;
    }
    if (
      tok === "&&" ||
      tok === "||" ||
      tok === "|" ||
      tok === ">" ||
      tok === "|>"
    ) {
      push(tok, "operator");
      isFirstWord = true;
      continue;
    }
    if (tok.startsWith('"') || tok.startsWith("'")) {
      push(tok, "string");
      isFirstWord = false;
      continue;
    }
    if (tok.startsWith("--") || (tok.startsWith("-") && tok.length > 1)) {
      push(tok, "flag");
      isFirstWord = false;
      continue;
    }
    if (/^[A-Za-z]:\\/.test(tok)) {
      push(tok, "path");
      isFirstWord = false;
      continue;
    }
    if (
      tok.startsWith("/") ||
      tok.startsWith("~/") ||
      tok.startsWith("./") ||
      tok.startsWith("../") ||
      tok === "~"
    ) {
      push(tok, "path");
      isFirstWord = false;
      continue;
    }
    if (/^\$\w+/.test(tok)) {
      push(tok, "var");
      isFirstWord = false;
      continue;
    }
    if (isFirstWord) {
      push(tok, "cmd");
      isFirstWord = false;
      continue;
    }
    push(tok, "text");
  }

  return parts;
}

function syntaxSpanClass(tone: string, surface: TerminalTheme) {
  if (surface === "paper") {
    return tone === "cmd"
      ? "text-fuchsia-900"
      : tone === "flag"
        ? "text-cyan-900"
        : tone === "path"
          ? "text-emerald-900"
          : tone === "string"
            ? "text-amber-900"
            : tone === "operator"
              ? "text-zinc-700"
              : tone === "var"
                ? "text-violet-900"
                : tone === "dim"
                  ? "text-zinc-500"
                  : "text-zinc-800";
  }
  return tone === "cmd"
    ? "text-fuchsia-200"
    : tone === "flag"
      ? "text-cyan-200"
      : tone === "path"
        ? "text-emerald-200"
        : tone === "string"
          ? "text-amber-200"
          : tone === "operator"
            ? "text-zinc-300/90"
            : tone === "var"
              ? "text-violet-200"
              : tone === "dim"
                ? "text-zinc-200/60"
                : "text-zinc-200/85";
}

type TerminalMutedTone = NonNullable<
  Extract<TerminalLine, { kind: "output" }>["tone"]
>;

function toneToClass(
  tone?: TerminalMutedTone,
  surface: TerminalTheme = "carbon",
) {
  if (surface === "paper") {
    switch (tone) {
      case "success":
        return "text-emerald-800";
      case "warning":
        return "text-amber-800";
      case "error":
        return "text-rose-800";
      case "info":
        return "text-cyan-900";
      case "muted":
      default:
        return "text-zinc-600";
    }
  }
  switch (tone) {
    case "success":
      return "text-emerald-300";
    case "warning":
      return "text-amber-300";
    case "error":
      return "text-red-300";
    case "info":
      return "text-cyan-200";
    case "muted":
    default:
      return "text-zinc-300/80";
  }
}

export function Terminal({
  commands = [],
  lines,
  busy = false,
  busyText = "working…",
  promptSymbol = "➜",
  username = "user",
  hostname = "nexus",
  title,
  typingSpeed = 28,
  typingJitter = 28,
  startupDelay = 450,
  delayBetweenCommands = 850,
  autoStart = true,
  loop = false,
  loopDelay = 1400,
  showCursor = true,
  enableSound = true,
  soundSpriteUrl,
  soundSpriteConfigUrl,
  simpleSoundUrl,
  showSoundToggle = true,
  showControls = true,
  theme = "carbon",
  fillHeight = false,
  className,
}: TerminalProps) {
  const live = lines !== undefined;
  const reduceMotion = useReducedMotion();
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const [soundOn, setSoundOn] = React.useState(enableSound);
  const soundOnRef = React.useRef(soundOn);

  const spriteSfx = React.useMemo(
    () =>
      createTerminalSpriteSfx(
        simpleSoundUrl
          ? { soundUrl: simpleSoundUrl, simpleMode: true }
          : { soundUrl: soundSpriteUrl, configUrl: soundSpriteConfigUrl },
      ),
    [simpleSoundUrl, soundSpriteUrl, soundSpriteConfigUrl],
  );

  React.useEffect(() => {
    soundOnRef.current = soundOn;
    spriteSfx.setMuted(!soundOn);
  }, [soundOn, spriteSfx]);

  const [state, setState] = React.useState<RunState>("idle");
  const [audioPrimed, setAudioPrimed] = React.useState(false);
  const soundPrimedRef = React.useRef(false);
  const [scriptLines, setScriptLines] = React.useState<TerminalLine[]>([]);
  const [activeInput, setActiveInput] = React.useState<string>("");
  const [cursorOn, setCursorOn] = React.useState(true);

  const feedLines = live ? lines : scriptLines;

  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const pausedRef = React.useRef(false);

  /** Unlock WebAudio after a user gesture (click/tap/drag). Required by browser autoplay rules. */
  const unlockAudio = React.useCallback(async () => {
    if (reduceMotion) return;
    try {
      await spriteSfx.resume();
      soundPrimedRef.current = true;
      setAudioPrimed(true);
    } catch {
      // ignore
    }
  }, [reduceMotion, spriteSfx]);

  React.useEffect(() => {
    if (!showCursor) return;
    const id = window.setInterval(() => setCursorOn((v) => !v), 520);
    return () => window.clearInterval(id);
  }, [showCursor]);

  React.useEffect(() => {
    if (!scrollerRef.current) return;
    const el = scrollerRef.current;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [feedLines, activeInput, busy]);

  const play = React.useCallback(
    (kind: "key" | "enter", ch?: string) => {
      if (!soundOnRef.current || reduceMotion) return;
      if (!soundPrimedRef.current) return;
      try {
        if (kind === "enter") {
          spriteSfx.tick({ kind: "enter" });
        } else {
          spriteSfx.tick({ kind: "key", ch: ch?.length ? ch[0]! : " " });
        }
      } catch {
        // ignore audio failures (autoplay policies, etc.)
      }
    },
    [reduceMotion, spriteSfx],
  );

  const pause = React.useCallback(() => {
    pausedRef.current = true;
    setState((s) => (s === "running" ? "paused" : s));
  }, []);

  const resumeTyping = React.useCallback(() => {
    pausedRef.current = false;
    setState((s) => (s === "paused" ? "running" : s));
  }, []);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pausedRef.current = false;
    setActiveInput("");
    setState("idle");
  }, []);

  const runOnce = React.useCallback(
    async (signal: AbortSignal) => {
      setScriptLines([]);
      setActiveInput("");

      await sleep(startupDelay, signal);

      for (let i = 0; i < commands.length; i++) {
        // Pause gate
        while (pausedRef.current) {
          await sleep(120, signal);
        }

        const cmd = commands[i];
        const input = cmd?.input ?? "";
        setActiveInput("");

        // Typing
        if (reduceMotion) {
          setActiveInput(input);
        } else {
          if (soundOnRef.current) {
            try {
              await spriteSfx.ensureLoaded();
            } catch {
              /* sprite optional */
            }
          }
          for (let c = 0; c < input.length; c++) {
            while (pausedRef.current) {
              await sleep(120, signal);
            }
            const ch = input[c]!;
            setActiveInput(input.slice(0, c + 1));
            play("key", ch);
            const base = typingSpeed;
            const jitter = Math.random() * typingJitter;
            const extra =
              ch === " "
                ? 14
                : ch === "/" || ch === "-"
                  ? 10
                  : ch === "."
                    ? 18
                    : 0;
            await sleep(base + jitter + extra, signal);
          }
        }

        // Commit input line
        setScriptLines((prev) => [...prev, { kind: "input", text: input }]);
        setActiveInput("");
        play("enter");

        // Optional run delay (like "processing")
        if (cmd?.runDelayMs && cmd.runDelayMs > 0) {
          const spinnerText = "running…";
          setScriptLines((prev) => [
            ...prev,
            { kind: "spinner", text: spinnerText, tone: "muted" },
          ]);
          await sleep(cmd.runDelayMs, signal);
          // Remove spinner line by replacing the last matching spinner.
          setScriptLines((prev) => {
            const idx = [...prev]
              .reverse()
              .findIndex((l) => l.kind === "spinner" && l.text === spinnerText);
            if (idx === -1) return prev;
            const real = prev.length - 1 - idx;
            return prev.filter((_, j) => j !== real);
          });
        }

        // Output reveal
        const outs = cmd?.output ?? [];
        for (const out of outs) {
          while (pausedRef.current) {
            await sleep(120, signal);
          }
          const line =
            typeof out === "string"
              ? ({ kind: "output", text: out, tone: "muted" } as const)
              : ({
                  kind: "output",
                  text: out.text,
                  tone: out.tone ?? "muted",
                } as const);
          setScriptLines((prev) => [...prev, line]);
          await sleep(reduceMotion ? 0 : 150 + Math.random() * 140, signal);
        }

        await sleep(delayBetweenCommands, signal);
      }
    },
    [
      commands,
      delayBetweenCommands,
      play,
      reduceMotion,
      startupDelay,
      typingJitter,
      typingSpeed,
      spriteSfx,
    ],
  );

  const start = React.useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    pausedRef.current = false;

    setState("running");
    try {
      do {
        await runOnce(ac.signal);
        if (!loop) break;
        await sleep(loopDelay, ac.signal);
      } while (!ac.signal.aborted);
      if (!ac.signal.aborted) setState("done");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setState("idle");
      }
    }
  }, [loop, loopDelay, runOnce]);

  React.useEffect(() => {
    if (live) return;
    if (!autoStart) return;
    if (!inView) return;
    const id = window.setTimeout(() => {
      void start();
    }, 0);
    return () => {
      window.clearTimeout(id);
      abortRef.current?.abort();
    };
  }, [live, autoStart, inView, start]);

  const skin = React.useMemo(() => {
    if (theme === "paper") {
      return {
        frame:
          "border-zinc-200/90 bg-zinc-50 shadow-[0_30px_90px_-35px_rgba(0,0,0,0.14)]",
        header: "border-b border-zinc-200/80 bg-zinc-100/90",
        headerTextTitle: "text-zinc-700",
        headerTextSub: "text-zinc-500",
        glass: "bg-white/95",
        glow: "from-cyan-500/12 via-fuchsia-500/8 to-transparent",
        btnGhost: "border-zinc-200/90 bg-white/80 text-zinc-800 hover:bg-white",
        soundOn:
          "border-cyan-600/25 bg-cyan-500/15 text-cyan-900 hover:bg-cyan-500/20",
        soundOff: "border-zinc-200/90 bg-white/70 text-zinc-600 hover:bg-white",
        promptSym: "text-emerald-700",
        promptUser: "text-cyan-900 font-medium",
        promptTilde: "text-zinc-600",
        typing: "text-zinc-900",
        cursor: "bg-zinc-900/85",
        badge: "border-amber-200/80 bg-amber-50 text-amber-950",
      };
    }
    if (theme === "midnight") {
      return {
        frame:
          "border-white/10 bg-zinc-950/80 shadow-[0_30px_90px_-35px_rgba(0,0,0,0.75)]",
        header: "border-b border-white/10 bg-zinc-950/70",
        headerTextTitle: "text-zinc-300/80",
        headerTextSub: "text-zinc-500/90",
        glass: "bg-zinc-950/65",
        glow: "from-cyan-500/20 via-fuchsia-500/12 to-transparent",
        btnGhost:
          "border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.07]",
        soundOn:
          "border-white/10 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/14",
        soundOff:
          "border-white/10 bg-white/[0.04] text-zinc-300/80 hover:bg-white/[0.07]",
        promptSym: "text-emerald-300",
        promptUser: "text-cyan-200",
        promptTilde: "text-zinc-400",
        typing: "text-zinc-200/85",
        cursor: "bg-zinc-100/90",
        badge: "border-amber-400/25 bg-amber-500/10 text-amber-100",
      };
    }
    return {
      frame:
        "border-white/10 bg-zinc-950 shadow-[0_30px_90px_-35px_rgba(0,0,0,0.75)]",
      header: "border-b border-white/10 bg-zinc-950/90",
      headerTextTitle: "text-zinc-300/80",
      headerTextSub: "text-zinc-500/90",
      glass: "bg-zinc-950/70",
      glow: "from-cyan-500/18 via-fuchsia-500/10 to-transparent",
      btnGhost:
        "border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.07]",
      soundOn:
        "border-white/10 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/14",
      soundOff:
        "border-white/10 bg-white/[0.04] text-zinc-300/80 hover:bg-white/[0.07]",
      promptSym: "text-emerald-300",
      promptUser: "text-cyan-200",
      promptTilde: "text-zinc-400",
      typing: "text-zinc-200/85",
      cursor: "bg-zinc-100/90",
      badge: "border-amber-400/25 bg-amber-500/10 text-amber-100",
    };
  }, [theme]);

  const shellPrompt = (
    <span className="select-none shrink-0">
      <span className={skin.promptSym}>{promptSymbol}</span>{" "}
      <span className={skin.promptUser}>
        {username}@{hostname}
      </span>{" "}
      <span className={skin.promptTilde}>~</span>{" "}
    </span>
  );

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative",
        fillHeight && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      {/* Glow + noise */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br blur-3xl",
          skin.glow,
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-[2.3rem] opacity-[0.12] mix-blend-overlay [background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22120%22%20height%3D%22120%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.9%22%20numOctaves%3D%223%22%20stitchTiles%3D%22stitch%22/%3E%3C/filter%3E%3Crect%20width%3D%22120%22%20height%3D%22120%22%20filter%3D%22url(%23n)%22%20opacity%3D%220.6%22/%3E%3C/svg%3E')]"
      />

      <div
        className={cn(
          "overflow-hidden rounded-[1.75rem] border",
          fillHeight && "flex min-h-0 flex-1 flex-col",
          skin.frame,
        )}
        onPointerDownCapture={() => {
          void unlockAudio();
        }}
      >
        {/* Header */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
            skin.header,
          )}
        >
          <div className="flex items-center gap-2">
            <span className="flex gap-2">
              <span
                className="size-2.5 rounded-full bg-red-400/90"
                aria-hidden
              />
              <span
                className="size-2.5 rounded-full bg-amber-400/90"
                aria-hidden
              />
              <span
                className="size-2.5 rounded-full bg-emerald-400/90"
                aria-hidden
              />
            </span>
            <div className="ml-2 hidden sm:block">
              <p
                className={cn("text-[11px] font-medium", skin.headerTextTitle)}
              >
                {title ?? `${hostname} — bash`}
              </p>
              <p className={cn("text-[11px]", skin.headerTextSub)}>
                {username}@{hostname}: ~
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showControls && !live ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    state === "running"
                      ? pause()
                      : state === "paused"
                        ? resumeTyping()
                        : start()
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                    skin.btnGhost,
                  )}
                >
                  {state === "running"
                    ? "Pause"
                    : state === "paused"
                      ? "Resume"
                      : "Replay"}
                </button>
                <button
                  type="button"
                  onClick={stop}
                  className={cn(
                    "hidden rounded-full border px-3 py-1.5 text-[11px] font-medium transition sm:inline-flex",
                    skin.btnGhost,
                  )}
                >
                  Reset
                </button>
              </div>
            ) : null}

            {showSoundToggle ? (
              <button
                type="button"
                onClick={() => {
                  void unlockAudio();
                  setSoundOn((v) => {
                    const next = !v;
                    soundOnRef.current = next;
                    spriteSfx.setMuted(!next);
                    return next;
                  });
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                  soundOn ? skin.soundOn : skin.soundOff,
                )}
              >
                Sound {soundOn ? "On" : "Off"}
              </button>
            ) : null}
            {soundOn && !audioPrimed && !reduceMotion ? (
              <span
                className={cn(
                  "inline-flex max-w-[140px] rounded-full border px-2.5 py-1 text-center text-[10px] font-medium leading-tight sm:max-w-none",
                  skin.badge,
                )}
              >
                Tap for sound
              </span>
            ) : null}
          </div>
        </div>

        {/* Body */}
        <div
          ref={scrollerRef}
          className={cn(
            "no-scrollbar relative px-5 py-5 font-mono text-[13px] leading-relaxed",
            fillHeight
              ? "min-h-0 flex-1 max-h-none overflow-y-auto"
              : "max-h-[min(68vh,560px)] overflow-auto",
            skin.glass,
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/35 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/45 to-transparent"
          />

          <div className="space-y-2">
            {feedLines.map((l, idx) => {
              if (l.kind === "input") {
                const spans = tokenizeBash(l.text);
                return (
                  <motion.div
                    key={`${idx}-in`}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex min-w-0 flex-wrap gap-x-1 gap-y-0.5"
                  >
                    {shellPrompt}
                    <span className="min-w-0 flex-1 break-words">
                      {spans.map((s, i) => (
                        <span
                          key={`${idx}-tok-${i}`}
                          className={syntaxSpanClass(s.tone, theme)}
                        >
                          {s.text}
                        </span>
                      ))}
                    </span>
                  </motion.div>
                );
              }

              if (l.kind === "progress") {
                return (
                  <motion.div
                    key={`${idx}-p`}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-1"
                  >
                    <div
                      className={cn(
                        theme === "paper"
                          ? "text-zinc-700"
                          : "text-zinc-200/80",
                        l.tone === "success"
                          ? theme === "paper"
                            ? "text-emerald-800"
                            : "text-emerald-200"
                          : theme === "paper"
                            ? "text-cyan-900"
                            : "text-cyan-200",
                      )}
                    >
                      {l.label}
                    </div>
                    <div
                      className={cn(
                        "h-2 w-full overflow-hidden rounded-full",
                        theme === "paper" ? "bg-zinc-200/80" : "bg-white/8",
                      )}
                    >
                      <motion.div
                        initial={reduceMotion ? false : { width: 0 }}
                        animate={{ width: `${clamp(l.value, 0, 100)}%` }}
                        transition={{ duration: reduceMotion ? 0 : 0.5 }}
                        className={cn(
                          "h-full rounded-full",
                          l.tone === "success"
                            ? "bg-emerald-400/70"
                            : "bg-cyan-400/70",
                        )}
                      />
                    </div>
                  </motion.div>
                );
              }

              if (l.kind === "spinner") {
                return (
                  <motion.div
                    key={`${idx}-s`}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex items-center gap-2",
                      toneToClass(l.tone, theme),
                    )}
                  >
                    <motion.span
                      aria-hidden
                      animate={reduceMotion ? undefined : { rotate: 360 }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                      className={cn(
                        "inline-block size-3 rounded-full border",
                        theme === "paper"
                          ? "border-zinc-300 border-t-zinc-700"
                          : "border-white/15 border-t-white/50",
                      )}
                    />
                    <span>{l.text}</span>
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={`${idx}-out`}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    toneToClass(l.tone, theme),
                  )}
                >
                  {l.text}
                </motion.div>
              );
            })}

            {/* Live mode: spinner while the backend is working. */}
            {live && busy ? (
              <div
                data-testid="terminal-busy"
                className={cn(
                  "flex items-center gap-2",
                  toneToClass("muted", theme),
                )}
              >
                <motion.span
                  aria-hidden
                  animate={reduceMotion ? undefined : { rotate: 360 }}
                  transition={{
                    duration: 0.9,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className={cn(
                    "inline-block size-3 rounded-full border",
                    theme === "paper"
                      ? "border-zinc-300 border-t-zinc-700"
                      : "border-white/15 border-t-white/50",
                  )}
                />
                <span>{busyText}</span>
              </div>
            ) : null}

            {/* Script mode: active typed input line */}
            {!live && state !== "idle" ? (
              <div className="flex min-w-0 flex-wrap gap-x-1 gap-y-0.5">
                {shellPrompt}
                <span className={cn("min-w-0 flex-1 break-words", skin.typing)}>
                  {activeInput}
                </span>
                {showCursor ? (
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-[1.15em] w-[8px] translate-y-[2px] rounded-[2px]",
                      skin.cursor,
                      cursorOn ? "opacity-90" : "opacity-25",
                    )}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Live mode: blinking cursor at the end of the feed. */}
            {live && !busy && showCursor ? (
              <div className="flex items-center">
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-[1.15em] w-[8px] rounded-[2px]",
                    skin.cursor,
                    cursorOn ? "opacity-90" : "opacity-25",
                  )}
                />
              </div>
            ) : null}
          </div>

          {/* A11y */}
          <p className="sr-only" aria-live="polite">
            {live
              ? `Terminal feed, ${feedLines.length} lines rendered${busy ? ", backend working" : ""}.`
              : `Terminal is ${state}. ${scriptLines.length} lines rendered.`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default Terminal;
