import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { AI_CONFIG } from "@/data";
import {
  AiApiError,
  createAiConfigClient,
  type AIConnectionStatus,
  type AiConfigMetadata,
  type AiProviderId,
  type AiProviderInfo,
} from "@/lib/ai-config";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const MIN_BUSY_MS = 1400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const client = createAiConfigClient();

type PanelStatus =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type AiConfigPanelProps = {
  onClose: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof AiApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}

function providerLabel(providers: AiProviderInfo[], id: AiProviderId): string {
  return providers.find((provider) => provider.id === id)?.label ?? id;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

type AdvancedValues = {
  timeoutMs?: number;
  maxRetries?: number;
  organizationId: string | null;
};

function parseAdvanced(
  timeoutSeconds: string,
  maxRetries: string,
  organizationId: string,
): { ok: true; value: AdvancedValues } | { ok: false; message: string } {
  const timeoutTrim = timeoutSeconds.trim();
  let timeoutMs: number | undefined;
  if (timeoutTrim.length > 0) {
    const seconds = Number(timeoutTrim);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
      return { ok: false, message: AI_CONFIG.invalidTimeout };
    }
    timeoutMs = seconds * 1000;
  }

  const retriesTrim = maxRetries.trim();
  let retries: number | undefined;
  if (retriesTrim.length > 0) {
    const value = Number(retriesTrim);
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      return { ok: false, message: AI_CONFIG.invalidRetries };
    }
    retries = value;
  }

  const org = organizationId.trim();
  return {
    ok: true,
    value: {
      timeoutMs,
      maxRetries: retries,
      organizationId: org.length > 0 ? org : null,
    },
  };
}

function connectionText(status: AIConnectionStatus): string {
  if (status === "testing") return AI_CONFIG.connectionTesting;
  if (status === "connected") return AI_CONFIG.connectionConnected;
  if (status === "failed") return AI_CONFIG.connectionFailed;
  return AI_CONFIG.connectionNotConnected;
}

export default function AiConfigPanel({ onClose }: AiConfigPanelProps) {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [providerId, setProviderId] = useState<AiProviderId | "">("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState<AiConfigMetadata | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [status, setStatus] = useState<PanelStatus>({ kind: "idle", message: "" });
  const [busy, setBusy] = useState<"test" | "save" | "reset" | null>(null);
  const [connection, setConnection] = useState<AIConnectionStatus>("not_connected");
  const [providerOpen, setProviderOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showApiKey, setShowApiKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState("8");
  const [maxRetries, setMaxRetries] = useState("0");
  const [organizationId, setOrganizationId] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const reduced = useReducedMotion() ?? false;

  const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const activeOptionId = providers[activeIndex]?.id ?? null;
  const formLocked = initialLoading || busy !== null;
  const canSubmit = !formLocked && providerId !== "" && baseUrl.trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [list, config] = await Promise.all([client.getProviders(), client.getConfig()]);
        if (cancelled) return;
        setProviders(list);
        const initialProvider = config
          ? (list.find((provider) => provider.id === config.provider) ?? list[0])
          : list[0];
        setProviderId(initialProvider?.id ?? "");
        setBaseUrl(config?.baseUrl ?? initialProvider?.defaultBaseUrl ?? "");
        setModel(config?.model ?? "");
        setTimeoutSeconds(config ? String(Math.round(config.timeoutMs / 1000)) : "8");
        setMaxRetries(config ? String(config.maxRetries) : "0");
        setOrganizationId(config?.organizationId ?? "");
        setConfigured(config);
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", message: describeError(error) });
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!providerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setProviderOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [providerOpen]);

  useEffect(() => {
    if (!providerOpen || !activeOptionId) return;
    document
      .getElementById(`ai-provider-option-${activeOptionId}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, providerOpen, activeOptionId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const markStale = () => {
    setConnection((current) => (current === "not_connected" ? current : "not_connected"));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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

  const handleProviderChange = (nextId: AiProviderId) => {
    const next = providers.find((provider) => provider.id === nextId);
    setProviderId(nextId);
    if (next && (baseUrl.trim().length === 0 || baseUrl === activeProvider?.defaultBaseUrl)) {
      setBaseUrl(next.defaultBaseUrl);
    }
    if (status.kind !== "idle" || status.message !== "") {
      setStatus({ kind: "idle", message: "" });
    }
    markStale();
  };

  const openProviderList = () => {
    if (formLocked || providers.length === 0) return;
    const index = providers.findIndex((provider) => provider.id === providerId);
    setActiveIndex(index >= 0 ? index : 0);
    setProviderOpen(true);
  };

  const selectProvider = (id: AiProviderId) => {
    handleProviderChange(id);
    setProviderOpen(false);
    providerTriggerRef.current?.focus();
  };

  const onProviderTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!providerOpen) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openProviderList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setProviderOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setProviderOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, providers.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(providers.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const provider = providers[activeIndex];
      if (provider) selectProvider(provider.id);
    }
  };

  const handleTest = async () => {
    if (busy !== null || !providerId) return;
    if (!isHttpUrl(baseUrl)) {
      setStatus({ kind: "error", message: AI_CONFIG.invalidBaseUrl });
      return;
    }
    const advanced = parseAdvanced(timeoutSeconds, maxRetries, organizationId);
    if (!advanced.ok) {
      setStatus({ kind: "error", message: advanced.message });
      return;
    }
    setBusy("test");
    setConnection("testing");
    const startedAt = Date.now();
    try {
      const result = await client.testConnection({
        provider: providerId,
        baseUrl: baseUrl.trim(),
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        ...advanced.value,
      });
      if (result.ok) {
        setConnection("connected");
        setStatus({
          kind: "success",
          message: `${result.detail ?? "Connection OK."} (${result.latencyMs} ms)`,
        });
      } else {
        setConnection("failed");
        setStatus({ kind: "error", message: result.error?.message ?? "Connection failed." });
      }
    } catch (error) {
      setConnection("failed");
      setStatus({ kind: "error", message: describeError(error) });
    } finally {
      const remaining = MIN_BUSY_MS - (Date.now() - startedAt);
      if (remaining > 0) await delay(remaining);
      setBusy(null);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy !== null || !providerId) return;
    if (!isHttpUrl(baseUrl)) {
      setStatus({ kind: "error", message: AI_CONFIG.invalidBaseUrl });
      return;
    }
    const advanced = parseAdvanced(timeoutSeconds, maxRetries, organizationId);
    if (!advanced.ok) {
      setStatus({ kind: "error", message: advanced.message });
      return;
    }
    setBusy("save");
    const startedAt = Date.now();
    try {
      const metadata = await client.saveConfig({
        provider: providerId,
        baseUrl: baseUrl.trim(),
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        ...advanced.value,
      });
      setConfigured(metadata);
      setApiKey("");
      setTimeoutSeconds(String(Math.round(metadata.timeoutMs / 1000)));
      setMaxRetries(String(metadata.maxRetries));
      setOrganizationId(metadata.organizationId ?? "");
      setStatus({ kind: "success", message: AI_CONFIG.savedNote });
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    } finally {
      const remaining = MIN_BUSY_MS - (Date.now() - startedAt);
      if (remaining > 0) await delay(remaining);
      setBusy(null);
    }
  };

  const handleReset = async () => {
    if (busy !== null) return;
    setBusy("reset");
    try {
      await client.resetConfig();
      setConfigured(null);
      setApiKey("");
      setConnection("not_connected");
      setStatus({ kind: "success", message: AI_CONFIG.resetNote });
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleResetClick = () => {
    if (busy !== null) return;
    if (!resetArmed) {
      setResetArmed(true);
      setStatus({ kind: "idle", message: AI_CONFIG.resetConfirmNote });
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    setResetArmed(false);
    void handleReset();
  };

  const statusClass =
    status.kind === "success"
      ? "dynix-status dynix-status-success"
      : status.kind === "error"
        ? "dynix-status dynix-status-error"
        : "dynix-status";

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
      onClick={onClose}
      className="dynix-modal-backdrop"
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-config-title"
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
        className="dynix-modal dynix-ai-modal outline-none"
      >
        <header className="dynix-modal-header">
          <div>
            <p className="dynix-modal-eyebrow">{AI_CONFIG.kicker}</p>
            <h2 id="ai-config-title" className="dynix-modal-title">
              {AI_CONFIG.title}
            </h2>
            <p className="dynix-modal-description">{AI_CONFIG.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={AI_CONFIG.close}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-white/55 outline-none transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1315]"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="dynix-form-body">
            <div className="dynix-conn-status" data-state={connection}>
              <span aria-hidden className="dynix-conn-dot" />
              <span className="dynix-conn-label">{connectionText(connection)}</span>
            </div>

            <div className="dynix-field">
              <label htmlFor="ai-provider" id="ai-provider-label" className="dynix-field-label">
                {AI_CONFIG.providerLabel}
              </label>
              <div
                ref={comboboxRef}
                className="dynix-combobox"
                data-open={providerOpen ? "true" : undefined}
              >
                <button
                  ref={providerTriggerRef}
                  id="ai-provider"
                  type="button"
                  role="combobox"
                  aria-expanded={providerOpen}
                  aria-haspopup="listbox"
                  aria-controls="ai-provider-listbox"
                  aria-labelledby="ai-provider-label"
                  aria-activedescendant={
                    providerOpen && activeOptionId
                      ? `ai-provider-option-${activeOptionId}`
                      : undefined
                  }
                  disabled={formLocked || providers.length === 0}
                  onClick={() => (providerOpen ? setProviderOpen(false) : openProviderList())}
                  onKeyDown={onProviderTriggerKeyDown}
                  className="dynix-input dynix-combobox-trigger"
                >
                  <span className="truncate">{activeProvider?.label ?? "—"}</span>
                  <ChevronDown aria-hidden className="dynix-combobox-chevron" />
                </button>
                {providerOpen && (
                  <div className="dynix-combobox-popup">
                    <ul
                      id="ai-provider-listbox"
                      role="listbox"
                      aria-labelledby="ai-provider-label"
                      className="dynix-combobox-list"
                    >
                      {providers.map((provider, index) => {
                        const isSelected = provider.id === providerId;
                        return (
                          <li
                            key={provider.id}
                            id={`ai-provider-option-${provider.id}`}
                            role="option"
                            aria-selected={isSelected}
                            data-active={index === activeIndex ? "true" : undefined}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => selectProvider(provider.id)}
                            className="dynix-combobox-option"
                          >
                            <span>{provider.label}</span>
                            {isSelected && <Check aria-hidden className="size-3 text-cyan-100" />}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="dynix-field">
              <label htmlFor="ai-base-url" className="dynix-field-label">
                {AI_CONFIG.baseUrlLabel}
              </label>
              <input
                id="ai-base-url"
                type="text"
                className="dynix-input"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  markStale();
                }}
                placeholder={activeProvider?.defaultBaseUrl || AI_CONFIG.baseUrlPlaceholder}
                spellCheck={false}
                autoComplete="off"
                disabled={formLocked}
              />
            </div>

            <div className="dynix-field">
              <label htmlFor="ai-model" className="dynix-field-label">
                {AI_CONFIG.modelLabel}
              </label>
              <input
                id="ai-model"
                type="text"
                className="dynix-input"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  markStale();
                }}
                placeholder={AI_CONFIG.modelPlaceholder}
                spellCheck={false}
                autoComplete="off"
                disabled={formLocked}
              />
            </div>

            <div className="dynix-field">
              <label htmlFor="ai-api-key" className="dynix-field-label">
                {AI_CONFIG.apiKeyLabel}
              </label>
              <div className="dynix-input-wrap">
                <input
                  id="ai-api-key"
                  type={showApiKey ? "text" : "password"}
                  className="dynix-input dynix-input-with-suffix"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    markStale();
                  }}
                  placeholder={
                    configured?.hasApiKey ? AI_CONFIG.apiKeyKeepPlaceholder : AI_CONFIG.apiKeyPlaceholder
                  }
                  spellCheck={false}
                  autoComplete="off"
                  disabled={formLocked}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((value) => !value)}
                  disabled={formLocked}
                  aria-label={showApiKey ? AI_CONFIG.hideKey : AI_CONFIG.showKey}
                  aria-pressed={showApiKey}
                  className="dynix-input-suffix"
                >
                  {showApiKey ? (
                    <EyeOff aria-hidden className="size-4" />
                  ) : (
                    <Eye aria-hidden className="size-4" />
                  )}
                </button>
              </div>
              {configured?.hasApiKey && (
                <p className="dynix-field-hint">{AI_CONFIG.apiKeyStoredNote}</p>
              )}
            </div>

            <div className="dynix-advanced" data-open={advancedOpen ? "true" : undefined}>
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                aria-expanded={advancedOpen}
                aria-controls="ai-advanced-body"
                disabled={initialLoading}
                className="dynix-advanced-toggle"
              >
                <span>{AI_CONFIG.advancedLabel}</span>
                <ChevronDown aria-hidden className="dynix-advanced-chevron" />
              </button>
              {advancedOpen && (
                <div id="ai-advanced-body" className="dynix-advanced-body">
                  <div className="dynix-advanced-grid">
                    <div className="dynix-field">
                      <label htmlFor="ai-timeout" className="dynix-field-label">
                        {AI_CONFIG.timeoutLabel}
                      </label>
                      <input
                        id="ai-timeout"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={60}
                        step={1}
                        className="dynix-input"
                        value={timeoutSeconds}
                        onChange={(event) => {
                          setTimeoutSeconds(event.target.value);
                          markStale();
                        }}
                        disabled={formLocked}
                      />
                      <p className="dynix-field-hint">{AI_CONFIG.timeoutHint}</p>
                    </div>
                    <div className="dynix-field">
                      <label htmlFor="ai-retries" className="dynix-field-label">
                        {AI_CONFIG.maxRetriesLabel}
                      </label>
                      <input
                        id="ai-retries"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={5}
                        step={1}
                        className="dynix-input"
                        value={maxRetries}
                        onChange={(event) => {
                          setMaxRetries(event.target.value);
                          markStale();
                        }}
                        disabled={formLocked}
                      />
                      <p className="dynix-field-hint">{AI_CONFIG.maxRetriesHint}</p>
                    </div>
                  </div>
                  <div className="dynix-field">
                    <label htmlFor="ai-organization" className="dynix-field-label">
                      {AI_CONFIG.organizationLabel}
                    </label>
                    <input
                      id="ai-organization"
                      type="text"
                      className="dynix-input"
                      value={organizationId}
                      onChange={(event) => {
                        setOrganizationId(event.target.value);
                        markStale();
                      }}
                      placeholder={AI_CONFIG.organizationPlaceholder}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={formLocked}
                    />
                    <p className="dynix-field-hint">{AI_CONFIG.organizationHint}</p>
                  </div>
                </div>
              )}
            </div>

            <div role="status" aria-live="polite" className={statusClass}>
              {initialLoading ? (
                <>
                  <LoaderCircle aria-hidden className="dynix-status-spinner size-3.5" />
                  <span>{AI_CONFIG.loadingNote}</span>
                </>
              ) : busy === "test" ? (
                <>
                  <LoaderCircle aria-hidden className="dynix-status-spinner size-3.5" />
                  <span>{AI_CONFIG.testingNote}</span>
                </>
              ) : (
                <span>
                  {status.kind === "idle" && status.message.length === 0
                    ? AI_CONFIG.idleNote
                    : status.message}
                </span>
              )}
            </div>
          </div>

          <footer className="dynix-modal-footer">
            <div className="min-w-0">
              <p className="dynix-selected-label">{AI_CONFIG.summaryLabel}</p>
              <p className="dynix-selected-value" data-empty={configured ? undefined : "true"}>
                {configured
                  ? `${providerLabel(providers, configured.provider)} · ${
                      configured.hasApiKey ? AI_CONFIG.keySaved : AI_CONFIG.noKey
                    }`
                  : AI_CONFIG.emptyHint}
              </p>
            </div>
            <div className="dynix-modal-actions">
              <button
                type="button"
                onClick={handleTest}
                disabled={!canSubmit}
                className="dynix-modal-button dynix-modal-button-secondary"
              >
                {AI_CONFIG.test}
              </button>
              <button
                type="button"
                onClick={handleResetClick}
                disabled={formLocked}
                className={
                  resetArmed
                    ? "dynix-modal-button dynix-modal-button-danger"
                    : "dynix-modal-button dynix-modal-button-secondary"
                }
              >
                {resetArmed ? AI_CONFIG.resetConfirm : AI_CONFIG.reset}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="dynix-modal-button dynix-modal-button-primary dynix-modal-button-wide"
              >
                {AI_CONFIG.save}
              </button>
            </div>
          </footer>
        </form>

        <AnimatePresence>
          {(busy === "save" || busy === "test") && (
            <motion.div
              key="busy-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.16, ease: EASE }}
              role="status"
              className="dynix-save-overlay"
            >
              <LoaderCircle aria-hidden className="dynix-status-spinner size-7 text-cyan-200" />
              <span className="dynix-save-label">
                {busy === "save" ? AI_CONFIG.savingNote : AI_CONFIG.testingNote}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
