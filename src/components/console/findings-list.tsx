import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { CONSOLE } from "@/data";
import { ScannerApiError, type Finding, type ScannerClient } from "@/lib/scanner-api";

const SEVERITY_TONES: Record<string, string> = {
  critical: "border-red-400/40 bg-red-500/12 text-red-200/95",
  high: "border-red-400/35 bg-red-500/10 text-red-200/90",
  medium: "border-orange-300/35 bg-orange-400/10 text-orange-100/90",
  low: "border-amber-300/25 bg-amber-400/[0.07] text-amber-100/85",
  info: "border-white/15 bg-white/[0.04] text-white/60",
};

function errorText(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return CONSOLE.findingsLoadFailed;
}

export default function FindingsList({
  client,
  scanId,
}: {
  client: ScannerClient;
  scanId: string;
}) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getFindings(scanId)
      .then((result) => {
        if (cancelled) return;
        setFindings(result);
        setLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(errorText(caught));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, scanId, reloadToken]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-4 text-[12px] text-white/50" role="status">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-cyan-200/80" />
        {CONSOLE.findingsLabel}…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-1 py-4 text-[12px] text-red-200/90">
        <span>{CONSOLE.findingsLoadFailed}</span>
        <span className="text-white/45">{error}</span>
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 text-[11px] text-white/70 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          <RefreshCw aria-hidden className="size-3" />
          {CONSOLE.reload}
        </button>
      </div>
    );
  }

  if (findings.length === 0) {
    return <p className="px-1 pb-2 text-[12px] text-white/50">{CONSOLE.findingsEmpty}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {findings.map((finding) => (
        <li key={finding.findingId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${
                SEVERITY_TONES[finding.severity] ?? SEVERITY_TONES.info
              }`}
            >
              <AlertTriangle aria-hidden className="size-3" />
              {finding.severity}
            </span>
            <span className="text-[13px] font-semibold text-white/90">{finding.title}</span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-white/65">{finding.description}</p>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            <span>Rule: {finding.ruleId}</span>
            <span>Verification: {finding.verificationStatus}</span>
            <span>Evidence refs: {finding.evidenceReferences.length}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
