import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { CONSOLE } from "@/data";
import {
  ScannerApiError,
  type EvidenceField,
  type ExecutableEvidence,
  type ProcessEvidence,
  type ScannerClient,
} from "@/lib/scanner-api";
import { fieldNeedsAttention, formatBytes, formatTimestamp, shortHash } from "@/lib/scan-format";
import { FieldStatusChip, SignatureChip } from "@/components/console/scan-status";

const PAGE_SIZE = 50;

function errorText(error: unknown): string {
  if (error instanceof ScannerApiError) return error.message;
  if (error instanceof Error) return error.message;
  return CONSOLE.inventoryLoadFailed;
}

function EvidenceValue({
  field,
  render,
}: {
  field: EvidenceField<string | number | null>;
  render?: (value: string | number) => string;
}) {
  if (field.value === null || field.value === undefined || fieldNeedsAttention(field.status)) {
    return <FieldStatusChip status={fieldNeedsAttention(field.status) ? field.status : "UNAVAILABLE"} />;
  }
  const text = render ? render(field.value) : String(field.value);
  return (
    <span title={field.note} className="text-white/80">
      {text}
    </span>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/45">
        {label}
      </dt>
      <dd className="mt-1 break-all text-[12px] leading-5 text-white/75">{children}</dd>
    </div>
  );
}

function EvidenceDetail({ row }: { row: ProcessEvidence }) {
  const executable = row.executable;
  return (
    <div className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
      <dl className="contents">
        <DetailItem label={CONSOLE.detailParentPid}>
          <EvidenceValue field={row.parentProcessId} />
        </DetailItem>
        <DetailItem label={CONSOLE.detailStartTime}>
          <EvidenceValue field={row.processStartTime} render={(value) => formatTimestamp(String(value))} />
        </DetailItem>
        <DetailItem label={CONSOLE.detailEvidenceId}>
          <span className="font-mono text-[11px] text-white/65">{row.evidenceId}</span>
        </DetailItem>
        <DetailItem label={CONSOLE.detailFilePath}>
          <EvidenceValue field={row.executablePath} />
        </DetailItem>
        <DetailItem label={CONSOLE.detailFileSize}>
          {executable ? <EvidenceValue field={executable.fileSizeBytes} render={(v) => formatBytes(Number(v))} /> : <FieldStatusChip status="NOT_APPLICABLE" />}
        </DetailItem>
        <DetailItem label={CONSOLE.detailCreated}>
          {executable ? <EvidenceValue field={executable.createdAt} render={(v) => formatTimestamp(String(v))} /> : <FieldStatusChip status="NOT_APPLICABLE" />}
        </DetailItem>
        <DetailItem label={CONSOLE.detailModified}>
          {executable ? <EvidenceValue field={executable.modifiedAt} render={(v) => formatTimestamp(String(v))} /> : <FieldStatusChip status="NOT_APPLICABLE" />}
        </DetailItem>
        <DetailItem label={CONSOLE.detailSha256}>
          {executable ? <EvidenceValue field={executable.sha256} /> : <FieldStatusChip status="NOT_APPLICABLE" />}
        </DetailItem>
        <DetailItem label={CONSOLE.detailSignatureMethod}>
          {executable ? (
            <span className="font-mono text-[11px] text-white/65">{executable.signature.method}</span>
          ) : (
            <FieldStatusChip status="NOT_APPLICABLE" />
          )}
        </DetailItem>
        <DetailItem label={CONSOLE.detailSigner}>
          {executable && executable.signature.signerName ? (
            <span>{executable.signature.signerName}</span>
          ) : (
            <span className="text-white/40">{CONSOLE.noneNote}</span>
          )}
        </DetailItem>
        <DetailItem label={CONSOLE.detailCollection}>
          <span className="font-mono text-[11px] text-white/65">{formatTimestamp(row.collectionTimestamp)}</span>
        </DetailItem>
      </dl>
    </div>
  );
}

export default function EvidenceTable({
  client,
  scanId,
  totalProcesses,
}: {
  client: ScannerClient;
  scanId: string;
  totalProcesses: number;
}) {
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<ProcessEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setOffset(0);
    setRows([]);
    setExpandedId(null);
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getEvidence(scanId, { limit: PAGE_SIZE, offset })
      .then((page) => {
        if (cancelled) return;
        setRows(page.evidence);
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
  }, [client, scanId, offset, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const from = rows.length === 0 ? 0 : offset + 1;
  const to = offset + rows.length;
  const total = Math.max(totalProcesses, to);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const hasNext = rows.length === PAGE_SIZE;

  return (
    <div>
      {error !== null ? (
        <div className="flex flex-wrap items-center gap-3 px-1 py-4 text-[12px] text-red-200/90">
          <span>{CONSOLE.inventoryLoadFailed}</span>
          <span className="text-white/45">{error}</span>
          <button
            type="button"
            onClick={reload}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 text-[11px] text-white/70 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            <RefreshCw aria-hidden className="size-3" />
            {CONSOLE.reload}
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex items-center gap-2.5 px-1 py-6 text-[12px] text-white/50" role="status">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-cyan-200/80" />
          {CONSOLE.inventoryLabel}…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-1 py-6 text-[12px] text-white/50">{CONSOLE.inventoryEmpty}</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{CONSOLE.inventoryLabel}</caption>
          <colgroup>
            <col className="w-[3.25rem]" />
            <col className="w-[9rem]" />
            <col />
            <col className="w-[4.75rem]" />
            <col className="w-[7.25rem]" />
            <col className="w-[6.25rem]" />
            <col className="w-[2.5rem]" />
          </colgroup>
          <thead>
            <tr className="border-b border-white/10 font-mono text-[9.5px] uppercase tracking-[0.2em] text-white/45">
              <th scope="col" className="py-2 pr-3 pl-1 font-semibold">PID</th>
              <th scope="col" className="px-3 py-2 font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 font-semibold">Path</th>
              <th scope="col" className="px-3 py-2 font-semibold">Size</th>
              <th scope="col" className="px-3 py-2 font-semibold">SHA-256</th>
              <th scope="col" className="px-3 py-2 font-semibold">Signature</th>
              <th scope="col" className="py-2 pr-1 pl-3">
                <span className="sr-only">{CONSOLE.detailToggle}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FragmentRow
                key={row.evidenceId}
                row={row}
                expanded={expandedId === row.evidenceId}
                onToggle={() => setExpandedId(expandedId === row.evidenceId ? null : row.evidenceId)}
              />
            ))}
          </tbody>
        </table>
      )}

      {!loading && error === null && rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            {CONSOLE.pagerShowing(from, to, total)} · {CONSOLE.pagerPage(page)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-[11px] text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              {CONSOLE.pagerPrev}
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasNext}
              className="inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-[11px] text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              {CONSOLE.pagerNext}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  row,
  expanded,
  onToggle,
}: {
  row: ProcessEvidence;
  expanded: boolean;
  onToggle: () => void;
}) {
  const signature: ExecutableEvidence["signature"] | null = row.executable?.signature ?? null;
  return (
    <>
      <tr
        className={`border-b border-white/[0.06] transition-colors ${
          expanded ? "bg-cyan-400/[0.04]" : "hover:bg-white/[0.025]"
        }`}
      >
        <td className="py-2.5 pr-3 pl-1 font-mono text-[12px] text-white/75">{row.processId}</td>
        <td className="px-3 py-2.5 text-[12px] text-white/85" title={row.processName.value ?? undefined}>
          <div className="truncate">
            <EvidenceValue field={row.processName} />
          </div>
        </td>
        <td className="px-3 py-2.5" title={row.executablePath.value ?? undefined}>
          <div className="truncate font-mono text-[11px] text-white/60">
            <EvidenceValue field={row.executablePath} />
          </div>
        </td>
        <td className="px-3 py-2.5 font-mono text-[11px] text-white/65">
          {row.executable ? (
            <EvidenceValue field={row.executable.fileSizeBytes} render={(v) => formatBytes(Number(v))} />
          ) : (
            <span className="text-white/35">{CONSOLE.noneNote}</span>
          )}
        </td>
        <td className="px-3 py-2.5 font-mono text-[11px] text-white/60">
          {row.executable ? (
            <span title={row.executable.sha256.value ?? undefined}>
              <EvidenceValue field={row.executable.sha256} render={(v) => shortHash(String(v), 12)} />
            </span>
          ) : (
            <span className="text-white/35">{CONSOLE.noneNote}</span>
          )}
        </td>
        <td className="overflow-hidden px-3 py-2.5">
          {signature !== null ? (
            <SignatureChip status={signature.status} signerName={signature.signerName} />
          ) : (
            <FieldStatusChip status="NOT_APPLICABLE" />
          )}
        </td>
        <td className="py-2.5 pr-1 pl-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={CONSOLE.detailToggle}
            title={CONSOLE.detailToggle}
            className="grid size-7 place-items-center rounded-md text-white/45 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
          <td colSpan={7} className="p-0">
            <EvidenceDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}
