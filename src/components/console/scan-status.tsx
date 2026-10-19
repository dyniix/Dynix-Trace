import { AlertTriangle, Check, ShieldAlert, ShieldQuestion } from "lucide-react";
import {
  fieldNeedsAttention,
  fieldStatusLabel,
  scanStatusLabel,
  signatureStatusLabel,
} from "@/lib/scan-format";
import type {
  EvidenceFieldStatus,
  ScanLifecycleStatus,
  SignatureStatus,
} from "@/lib/scanner-api";

const STATUS_TONES: Record<ScanLifecycleStatus, { badge: string; dot: string }> = {
  QUEUED: {
    badge: "border-amber-300/30 bg-amber-400/10 text-amber-100/90",
    dot: "bg-amber-300",
  },
  RUNNING: {
    badge: "border-cyan-300/35 bg-cyan-400/10 text-cyan-100/90",
    dot: "bg-cyan-300 animate-pulse",
  },
  COMPLETED: {
    badge: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100/90",
    dot: "bg-emerald-300",
  },
  COMPLETED_WITH_WARNINGS: {
    badge: "border-orange-300/35 bg-orange-400/10 text-orange-100/90",
    dot: "bg-orange-300",
  },
  FAILED: {
    badge: "border-red-400/35 bg-red-500/10 text-red-200/90",
    dot: "bg-red-400",
  },
  CANCELLED: {
    badge: "border-white/15 bg-white/[0.05] text-white/60",
    dot: "bg-white/40",
  },
};

export function ScanStatusBadge({
  status,
  className = "",
}: {
  status: ScanLifecycleStatus;
  className?: string;
}) {
  const tone = STATUS_TONES[status];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${tone.badge} ${className}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {scanStatusLabel(status)}
    </span>
  );
}

const SIGNATURE_TONES: Record<SignatureStatus, string> = {
  VALID: "border-emerald-300/25 bg-emerald-400/[0.08] text-emerald-100/85",
  INVALID: "border-red-400/35 bg-red-500/10 text-red-200/90",
  UNSIGNED: "border-white/15 bg-white/[0.04] text-white/60",
  UNKNOWN: "border-amber-300/25 bg-amber-400/[0.07] text-amber-100/85",
  UNAVAILABLE: "border-white/12 bg-white/[0.03] text-white/45",
};

export function SignatureChip({
  status,
  signerName,
}: {
  status: SignatureStatus;
  signerName?: string | null;
}) {
  return (
    <span
      title={status === "VALID" && signerName ? signerName : undefined}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] leading-4 ${SIGNATURE_TONES[status]}`}
    >
      {status === "VALID" ? (
        <Check aria-hidden className="size-3 shrink-0" />
      ) : status === "INVALID" ? (
        <ShieldAlert aria-hidden className="size-3 shrink-0" />
      ) : (
        <ShieldQuestion aria-hidden className="size-3 shrink-0 opacity-70" />
      )}
      <span className="truncate">{signatureStatusLabel(status)}</span>
    </span>
  );
}

export function FieldStatusChip({ status }: { status: EvidenceFieldStatus }) {
  const attention = fieldNeedsAttention(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] leading-4 ${
        attention
          ? "border-amber-300/25 bg-amber-400/[0.07] text-amber-100/85"
          : "border-white/12 bg-white/[0.03] text-white/55"
      }`}
    >
      {attention && <AlertTriangle aria-hidden className="size-3 shrink-0" />}
      {fieldStatusLabel(status)}
    </span>
  );
}
