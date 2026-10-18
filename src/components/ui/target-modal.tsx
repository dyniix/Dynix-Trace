import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import { GAMES, TARGET_MODAL } from "@/data";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const TARGETS = [...GAMES].sort((a, b) => a.order - b.order);

type TargetModalProps = {
  initialId: string | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
};

export default function TargetModal({ initialId, onCancel, onConfirm }: TargetModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;

  const selected = TARGETS.find((game) => game.id === selectedId) ?? null;

  useEffect(() => {
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === panel) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      initial={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(0, 0, 0, 0)" }}
      animate={{ backdropFilter: "blur(12px)", backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      exit={{
        backdropFilter: "blur(0px)",
        backgroundColor: "rgba(0, 0, 0, 0)",
        transition: { duration: reduced ? 0 : 0.2, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ duration: reduced ? 0 : 0.45, ease: [0.4, 0, 0.2, 1] }}
      onClick={onCancel}
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="target-modal-title"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
          initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: reduced ? 0 : 8,
            scale: reduced ? 1 : 0.99,
            transition: { duration: reduced ? 0 : 0.14, ease: EASE },
          }}
          transition={{ duration: reduced ? 0 : 0.38, ease: [0.4, 0, 0.2, 1] }}
          className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0e11]/95 shadow-[0_28px_70px_-28px_rgba(0,0,0,0.9)] outline-none"
        >
          <header className="relative flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-200/70">
                {TARGET_MODAL.kicker}
              </span>
              <h2
                id="target-modal-title"
                className="mt-2 text-xl font-bold uppercase tracking-[0.04em] text-white sm:text-2xl"
              >
                {TARGET_MODAL.title}
              </h2>
              <p className="mt-1.5 text-sm text-white/55">{TARGET_MODAL.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label={TARGET_MODAL.close}
              className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-white/55 outline-none transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0e11]"
            >
              <X aria-hidden className="size-4" />
            </button>
          </header>

          <div
            role="group"
            aria-label={TARGET_MODAL.listLabel}
            className="relative mt-4 min-h-0 overflow-y-auto px-2 pb-1 sm:px-3"
          >
            <div className="flex flex-col gap-2">
              {TARGETS.map((game) => {
                const isSelected = game.id === selectedId;
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => setSelectedId(game.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-4 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0e11] ${
                      isSelected
                        ? "border-cyan-300/60 bg-cyan-400/[0.07]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span
                      className={`w-6 shrink-0 font-mono text-[11px] tracking-[0.2em] ${
                        isSelected ? "text-cyan-200" : "text-white/40"
                      }`}
                    >
                      {String(game.order).padStart(2, "0")}
                    </span>
                    <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white/[0.05]">
                      <img
                        src={game.icon}
                        alt=""
                        draggable={false}
                        className={`size-full object-contain ${game.iconClassName ?? ""}`}
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-inset ring-white/[0.08]"
                      />
                    </span>
                    <span
                      className={`flex-1 text-sm font-semibold uppercase tracking-[0.12em] ${
                        isSelected ? "text-white" : "text-white/75"
                      }`}
                    >
                      {game.label}
                    </span>
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-150 ${
                        isSelected ? "border-cyan-300/70 bg-cyan-400/20" : "border-white/15"
                      }`}
                    >
                      {isSelected && <Check aria-hidden className="size-3 text-cyan-100" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="relative mt-4 flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">
                {TARGET_MODAL.summaryLabel}
              </span>
              <span
                className={`mt-1 block truncate text-sm font-semibold ${
                  selected ? "text-cyan-100" : "text-white/40"
                }`}
              >
                {selected ? selected.label : TARGET_MODAL.emptyHint}
              </span>
            </div>
            <div className="flex w-full shrink-0 items-center gap-2.5 sm:w-auto">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-5 text-[13px] font-medium tracking-wide text-white/75 outline-none transition-colors duration-150 hover:border-white/30 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0e11] sm:h-10 sm:flex-none"
              >
                {TARGET_MODAL.cancel}
              </button>
              <button
                type="button"
                onClick={() => selected && onConfirm(selected.id)}
                disabled={!selected}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-white px-6 text-[13px] font-bold uppercase tracking-[0.14em] text-black outline-none transition-colors duration-150 hover:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0e11] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/35 sm:h-10 sm:flex-none"
              >
                {TARGET_MODAL.confirm}
              </button>
            </div>
          </footer>
        </motion.div>
      </div>
    </motion.div>
  );
}
