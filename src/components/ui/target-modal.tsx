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
      initial={{
        backdropFilter: "blur(0px) saturate(115%)",
        backgroundColor: "rgba(3, 9, 11, 0)",
      }}
      animate={{
        backdropFilter: "blur(10px) saturate(115%)",
        backgroundColor: "rgba(3, 9, 11, 0.52)",
      }}
      exit={{
        backdropFilter: "blur(0px) saturate(115%)",
        backgroundColor: "rgba(3, 9, 11, 0)",
        transition: { duration: reduced ? 0 : 0.2, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ duration: reduced ? 0 : 0.45, ease: [0.4, 0, 0.2, 1] }}
      onClick={onCancel}
      className="dynix-modal-backdrop"
    >
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
        className="dynix-modal outline-none"
      >
        <header className="dynix-modal-header">
          <div>
            <p className="dynix-modal-eyebrow">{TARGET_MODAL.kicker}</p>
            <h2 id="target-modal-title" className="dynix-modal-title">
              {TARGET_MODAL.title}
            </h2>
            <p className="dynix-modal-description">{TARGET_MODAL.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={TARGET_MODAL.close}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-white/55 outline-none transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1315]"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div role="group" aria-label={TARGET_MODAL.listLabel} className="dynix-game-list">
          {TARGETS.map((game) => {
            const isSelected = game.id === selectedId;
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => setSelectedId(game.id)}
                aria-pressed={isSelected}
                className="dynix-game-option"
              >
                <span className="dynix-game-number">{String(game.order).padStart(2, "0")}</span>
                <span className="dynix-game-icon-frame">
                  <img
                    src={game.icon}
                    alt=""
                    draggable={false}
                    className={`dynix-game-icon ${game.iconClassName ?? ""}`}
                  />
                </span>
                <span className="dynix-game-name">{game.label}</span>
                <span className="dynix-game-indicator">
                  {isSelected && <Check aria-hidden className="size-3 text-cyan-100" />}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="dynix-modal-footer">
          <div className="min-w-0">
            <p className="dynix-selected-label">{TARGET_MODAL.summaryLabel}</p>
            <p className="dynix-selected-value" data-empty={selected ? undefined : "true"}>
              {selected ? selected.label : TARGET_MODAL.emptyHint}
            </p>
          </div>
          <div className="dynix-modal-actions">
            <button
              type="button"
              onClick={onCancel}
              className="dynix-modal-button dynix-modal-button-secondary"
            >
              {TARGET_MODAL.cancel}
            </button>
            <button
              type="button"
              onClick={() => selected && onConfirm(selected.id)}
              disabled={!selected}
              className="dynix-modal-button dynix-modal-button-primary"
            >
              {TARGET_MODAL.confirm}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
