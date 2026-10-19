import { useContext, useEffect, useRef, useState, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PulsingBorder } from "@paper-design/shaders-react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import TargetModal from "@/components/ui/target-modal";
import AiConfigPanel from "@/components/ui/ai-config-panel";
import { Monogram, MonogramDefs } from "@/components/ui/monogram";
import { SceneBoostContext } from "@/components/ui/scene-background";
import { adoptRunningScan, startActiveScan, useActiveScan } from "@/lib/active-scan";
import { ScannerApiError } from "@/lib/scanner-api";
import {
  AI_CONFIG,
  BRAND,
  BRAND_LINE,
  BRAND_SUB,
  CORNER_STATUS,
  CTAS,
  GAMES,
  HERO_KICKER,
  HERO_LINES,
  HERO_PARAGRAPH,
  MONITOR_LABEL,
  MONITOR_NOTE,
  NAV_LINKS,
  ROTATING_TEXT,
  STATUS,
  VERSION,
  type Game,
} from "@/data";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function messageOf(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}

const SEAL_RADIUS = 83;
const SEAL_CIRCUMFERENCE = 2 * Math.PI * SEAL_RADIUS;

function fadeUp(delay: number, reduced: boolean) {
  return {
    initial: { opacity: 0, y: reduced ? 0 : 26 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? 0 : 0.9, delay: reduced ? 0 : delay, ease: EASE },
  };
}

function TraceButton({
  active,
  onClick,
  buttonRef,
}: {
  active: boolean;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={active ? undefined : onClick}
      aria-busy={active}
      aria-disabled={active}
      aria-haspopup="dialog"
      className={`group relative h-13 w-64 rounded-full outline-none transition-transform duration-200 ease-out focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:translate-y-0 active:scale-[0.985] ${
        active ? "pointer-events-none" : "cursor-pointer hover:-translate-y-0.5"
      }`}
    >
      <span aria-hidden className="absolute inset-0 block">
        <span className="absolute left-0 top-1/2 h-13 w-[calc(100%-4rem)] -translate-y-1/2 overflow-hidden rounded-full bg-white">
          <span className="absolute inset-0 -translate-x-full bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.25),transparent)] transition-transform duration-0 ease-out group-hover:translate-x-full group-hover:duration-700" />
        </span>
        <span className="absolute right-0 top-1/2 size-13 -translate-y-1/2 rounded-full bg-white" />
      </span>
      <span className="relative z-10 flex h-full items-center pl-6">
        <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-black">
          {active ? CTAS.primaryActive : CTAS.primary}
        </span>
        <span className="absolute right-0 top-1/2 grid size-13 -translate-y-1/2 place-items-center">
          {active ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin text-black" />
          ) : (
            <ArrowUpRight
              aria-hidden
              className="size-4 text-black transition-transform duration-300 group-hover:rotate-45"
            />
          )}
        </span>
      </span>
    </button>
  );
}

function RotatingSeal({ active, reduced }: { active: boolean; reduced: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotate: -14 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: reduced ? 0 : 1.4, delay: reduced ? 0 : 1.05, ease: EASE }}
      aria-hidden
      className="pointer-events-none absolute right-12 bottom-12 z-10 hidden size-52 xl:block"
    >
      <PulsingBorder
        className="absolute inset-0 size-full"
        colors={["#22d3ee", "#f97316", "#67e8f9", "#0ea5e9"]}
        colorBack="#00000000"
        roundness={1}
        thickness={0.08}
        softness={0.7}
        intensity={0.3}
        bloom={0.9}
        spots={4}
        spotSize={0.5}
        pulse={0.45}
        smoke={0.15}
        smokeSize={0.5}
        aspectRatio="square"
        speed={reduced ? 0 : active ? 1.6 : 0.4}
      />
      <svg viewBox="0 0 208 208" className="spin-slow absolute inset-0 size-full">
        <defs>
          <path
            id="seal-ring"
            d="M104,104 m-83,0 a83,83 0 1,1 166,0 a83,83 0 1,1 -166,0"
            fill="none"
          />
        </defs>
        <text className="fill-white/50 font-mono" fontSize="9.5" letterSpacing="1.5">
          <textPath
            href="#seal-ring"
            textLength={SEAL_CIRCUMFERENCE}
            lengthAdjust="spacing"
          >
            {ROTATING_TEXT}
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <Monogram className="size-16 drop-shadow-[0_0_18px_rgba(34,211,238,0.55)]" />
      </div>
    </motion.div>
  );
}

export default function Hero() {
  const [modalOpen, setModalOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [target, setTarget] = useState<Game | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion() ?? false;
  const setSceneBoost = useContext(SceneBoostContext);
  const { inProgress: tracing } = useActiveScan();

  // Returning to home while the backend is still tracing resumes the locked
  // state instead of offering a fresh start (also survives a page reload).
  useEffect(() => {
    void adoptRunningScan();
  }, []);

  // Accelerate the shared mesh while the trace handoff plays.
  useEffect(() => {
    setSceneBoost(tracing);
    return () => setSceneBoost(false);
  }, [tracing, setSceneBoost]);

  // The one place a scan starts: home → target → real scan. The trace
  // animation keeps running here until the scan reaches a terminal state —
  // and the button stays locked for exactly that window.
  const beginScan = async () => {
    try {
      await startActiveScan();
    } catch (error) {
      setStartError(messageOf(error));
    }
  };

  const closeTargetModal = () => {
    setModalOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const closeAiConfig = () => {
    setAiOpen(false);
    requestAnimationFrame(() => aiButtonRef.current?.focus());
  };

  const confirmTarget = (id: string) => {
    setTarget(GAMES.find((game) => game.id === id) ?? null);
    setModalOpen(false);
    setStartError(null);
    requestAnimationFrame(() => {
      buttonRef.current?.focus();
      void beginScan();
    });
  };

  return (
    <section className="relative flex min-h-svh w-full flex-col overflow-hidden text-white">
      {tracing && !reduced && <div className="scan-sweep" />}

      <motion.nav
        initial={{ y: reduced ? 0 : -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduced ? 0 : 1, ease: EASE }}
        className="relative z-20 flex items-center justify-between px-6 py-5 lg:px-10"
      >
        <a
          href="#"
          className="flex items-center gap-3 rounded-xl transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-400/5 backdrop-blur">
            <Monogram className="size-5" />
          </span>
          <span className="text-sm font-semibold tracking-[0.35em]">
            {BRAND} <span className="font-light text-white/55">{BRAND_SUB}</span>
          </span>
        </a>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[13px] font-medium tracking-wide text-white/55 transition hover:text-white active:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pr-1.5 pl-3 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60 backdrop-blur">
            <span role="status" className="inline-flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${
                  tracing ? "animate-pulse bg-cyan-300" : target ? "bg-cyan-300" : "bg-emerald-400"
                }`}
              />
              <span className="hidden sm:inline">
                {tracing ? STATUS.active : target ? `Target — ${target.label}` : STATUS.idle}
              </span>
            </span>
            <span aria-hidden className="h-3 w-px bg-white/15" />
            <button
              ref={aiButtonRef}
              type="button"
              onClick={() => setAiOpen(true)}
              aria-haspopup="dialog"
              className="rounded-full px-2 py-0.5 text-cyan-100/75 outline-none transition-colors duration-150 hover:bg-white/[0.08] hover:text-cyan-50 focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {AI_CONFIG.trigger}
            </button>
          </span>
        </div>
      </motion.nav>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-24 text-center [@media(max-height:800px)]:pb-12">
        <motion.div {...fadeUp(0.2, reduced)}>
          <span className="inline-flex items-center gap-2.5 rounded-full border border-cyan-300/20 bg-cyan-400/[0.06] px-4 py-1.5 backdrop-blur">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-300 opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-cyan-300" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-100/70">
              {BRAND_LINE} — {VERSION}
            </span>
          </span>
        </motion.div>

        <motion.p
          {...fadeUp(0.3, reduced)}
          className="text-shimmer mt-8 text-base font-light italic sm:text-lg [@media(max-height:800px)]:mt-6"
        >
          {HERO_KICKER}
        </motion.p>

        <h1 className="mt-3 font-sans uppercase leading-[0.98] tracking-[-0.02em] sm:mt-4">
          <motion.span
            {...fadeUp(0.42, reduced)}
            className="glow-cyan block text-6xl font-black sm:text-7xl md:text-8xl lg:text-[clamp(96px,13.2vh,118px)]"
          >
            {HERO_LINES[0]}
          </motion.span>
          <motion.span
            {...fadeUp(0.54, reduced)}
            className="block text-4xl font-light italic text-white/55 sm:text-5xl md:text-6xl lg:text-[clamp(56px,7.6vh,68px)]"
          >
            {HERO_LINES[1]}
          </motion.span>
        </h1>

        <motion.p
          {...fadeUp(0.66, reduced)}
          className="mx-auto mt-7 max-w-xl text-pretty text-sm leading-relaxed text-white/55 sm:text-base [@media(max-height:800px)]:mt-5"
        >
          {HERO_PARAGRAPH}
        </motion.p>

        <motion.div
          {...fadeUp(0.78, reduced)}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-6 [@media(max-height:800px)]:mt-7"
        >
          <a
            href="#console"
            className="inline-flex h-12 items-center rounded-full border border-white/15 bg-white/[0.04] px-7 text-sm font-medium tracking-wide text-white/75 backdrop-blur transition duration-150 hover:border-white/30 hover:bg-white/[0.08] hover:text-white active:scale-[0.99] active:border-white/25 active:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {CTAS.secondary}
          </a>
          <TraceButton active={tracing} onClick={() => setModalOpen(true)} buttonRef={buttonRef} />
        </motion.div>

        {startError !== null && (
          <motion.p
            {...fadeUp(0.82, reduced)}
            role="alert"
            className="mt-4 max-w-md text-[12px] leading-5 text-red-200/85"
          >
            {CTAS.primaryError} <span className="text-white/45">{startError}</span>
          </motion.p>
        )}

        <motion.div {...fadeUp(0.92, reduced)} className="mt-14 flex flex-col items-center gap-4 [@media(max-height:800px)]:mt-8">
          <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/55">
            {MONITOR_LABEL}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {GAMES.map((game, i) => (
              <span
                key={game.id}
                className="flex items-center gap-2 font-mono text-[11px] text-white/55"
              >
                <span
                  className={`size-1.5 rounded-full ${tracing ? "animate-pulse bg-cyan-300" : ""}`}
                  style={
                    tracing
                      ? { animationDelay: `${i * 140}ms` }
                      : { backgroundColor: game.hue, opacity: 0.85 }
                  }
                />
                {game.name}
              </span>
            ))}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
            {MONITOR_NOTE}
          </span>
        </motion.div>
      </div>

      <motion.div
        {...fadeUp(1.08, reduced)}
        className="pointer-events-none absolute bottom-10 left-10 z-10 hidden font-mono text-[10px] tracking-[0.3em] text-white/55 md:block [@media(max-height:800px)]:bottom-6"
      >
        {tracing ? CORNER_STATUS.active : CORNER_STATUS.idle}
      </motion.div>

      <RotatingSeal active={tracing} reduced={reduced} />

      <MonogramDefs />

      <AnimatePresence>
        {modalOpen && (
          <TargetModal
            initialId={target?.id ?? null}
            onCancel={closeTargetModal}
            onConfirm={confirmTarget}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {aiOpen && <AiConfigPanel onClose={closeAiConfig} />}
      </AnimatePresence>
    </section>
  );
}
