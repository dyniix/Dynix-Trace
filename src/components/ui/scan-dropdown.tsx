import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, History, LoaderCircle, RefreshCw } from "lucide-react";
import { formatDuration, formatTimestamp, scanStatusLabel } from "@/lib/scan-format";
import type { ScanJob, ScanLifecycleStatus } from "@/lib/scanner-api";

const STATUS_DOTS: Record<ScanLifecycleStatus, string> = {
  QUEUED: "bg-amber-300",
  RUNNING: "bg-cyan-300 animate-pulse",
  COMPLETED: "bg-emerald-300",
  COMPLETED_WITH_WARNINGS: "bg-orange-300",
  FAILED: "bg-red-400",
  CANCELLED: "bg-white/40",
};

function scanMeta(scan: ScanJob): string {
  return `${scanStatusLabel(scan.status)} · ${scan.processCount} proc · ${scan.findingsCount} findings`;
}

function scanTime(scan: ScanJob): string {
  if (scan.completedAt !== null && scan.startedAt !== null) {
    return `${formatTimestamp(scan.completedAt)} · ${formatDuration(scan.startedAt, scan.completedAt)}`;
  }
  return formatTimestamp(scan.startedAt ?? scan.createdAt);
}

/**
 * Custom recorded-scan selector — an opaque listbox panel instead of a native
 * select, so the picker never smears the content it opens over.
 */
export default function ScanDropdown({
  scans,
  selectedScanId,
  onSelect,
  loading,
  error,
  onRetry,
  disabled = false,
  label,
  placeholder,
  emptyLabel,
  loadingLabel,
  errorLabel,
  refreshLabel,
  testId,
}: {
  scans: ScanJob[];
  selectedScanId: string | null;
  onSelect: (scanId: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  disabled?: boolean;
  label: string;
  placeholder: string;
  emptyLabel: string;
  loadingLabel: string;
  errorLabel: string;
  refreshLabel: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = selectedScanId === null ? null : scans.find((scan) => scan.scanId === selectedScanId) ?? null;
  const selectedIndex = selectedScanId === null ? -1 : scans.findIndex((scan) => scan.scanId === selectedScanId);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    listRef.current?.focus();
  }, [open, selectedIndex]);

  const select = useCallback(
    (scanId: string) => {
      onSelect(scanId);
      close(true);
    },
    [onSelect, close],
  );

  const onListKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (scans.length === 0) {
        if (event.key === "Escape") close(true);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(scans.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(scans.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const scan = scans[activeIndex];
        if (scan !== undefined) select(scan.scanId);
      } else if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        close(true);
      }
    },
    [scans, activeIndex, select, close],
  );

  return (
    <div ref={rootRef} data-testid={testId} className="flex min-w-0 items-center gap-1.5">
      <div className="relative min-w-0">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={label}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className="glass-btn flex h-9 w-full max-w-[380px] min-w-0 cursor-pointer items-center gap-2.5 rounded-xl pr-2.5 pl-3 text-left outline-none focus-visible:border-cyan-300/50 focus-visible:ring-2 focus-visible:ring-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <History aria-hidden className="size-3.5 shrink-0 text-cyan-100/55" />
          {selected !== null ? (
            <>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_DOTS[selected.status]}`} />
              <span className="min-w-0 truncate font-mono text-[11px] text-white/85">
                {selected.scanId}
              </span>
              <span className="hidden min-w-0 truncate font-mono text-[10px] text-white/40 xl:inline">
                {scanMeta(selected)}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate font-mono text-[11px] text-white/45">
              {loading ? loadingLabel : scans.length === 0 && error === null ? emptyLabel : placeholder}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {loading && <LoaderCircle aria-hidden className="size-3 animate-spin text-cyan-200/70" />}
            <ChevronDown
              aria-hidden
              className={`size-3.5 text-white/40 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>

        {open && (
          <div
            className="dropdown-panel absolute top-full left-0 z-50 mt-2 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-2xl"
          >
            {error !== null ? (
              <div className="flex flex-col gap-2.5 px-3.5 py-3.5">
                <p role="alert" className="text-[12px] leading-5 text-red-200/90">
                  {errorLabel} <span className="text-white/45">{error}</span>
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={loading}
                  className="glass-btn inline-flex h-8 w-fit items-center gap-1.5 rounded-lg px-3 text-[11px] text-white/75 hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                >
                  <RefreshCw aria-hidden className={`size-3 ${loading ? "animate-spin" : ""}`} />
                  {refreshLabel}
                </button>
              </div>
            ) : scans.length === 0 ? (
              <p className="px-3.5 py-3.5 text-[12px] text-white/50">
                {loading ? loadingLabel : emptyLabel}
              </p>
            ) : (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={label}
                aria-activedescendant={scans[activeIndex] !== undefined ? `${listId}-${activeIndex}` : undefined}
                tabIndex={-1}
                onKeyDown={onListKeyDown}
                className="no-scrollbar flex max-h-[19rem] flex-col gap-0.5 overflow-y-auto p-1.5 outline-none"
              >
                {scans.map((scan, index) => {
                  const isSelected = scan.scanId === selectedScanId;
                  return (
                    <li
                      key={scan.scanId}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(scan.scanId)}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition ${
                        isSelected
                          ? "border-cyan-300/25 bg-cyan-400/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_20px_-6px_rgba(45,212,220,0.55)]"
                          : index === activeIndex
                            ? "border-transparent bg-cyan-400/[0.09]"
                            : "border-transparent hover:bg-white/[0.045]"
                      }`}
                    >
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_DOTS[scan.status]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate font-mono text-[11.5px] text-white/85">
                            {scan.scanId}
                          </span>
                          {isSelected && <Check aria-hidden className="size-3 shrink-0 text-cyan-200/85" />}
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-3 font-mono text-[10px] text-white/40">
                          <span className="truncate">{scanMeta(scan)}</span>
                          <span className="shrink-0">{scanTime(scan)}</span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRetry}
        disabled={disabled || loading}
        aria-label={refreshLabel}
        title={refreshLabel}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        {loading ? (
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-3.5" />
        )}
      </button>

      {error !== null && (
        <span role="alert" className="hidden truncate text-[10px] text-red-200/80 lg:block">
          {errorLabel}
        </span>
      )}
    </div>
  );
}
