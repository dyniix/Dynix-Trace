import { z } from "zod";

/**
 * Console feed for a scan. Events are append-only, ordered per scan by a
 * monotonically increasing `seq` assigned by persistence. They describe what
 * the engine is doing (commands, stage transitions, progress, results) and
 * are rendered as terminal lines by the console.
 *
 * Kinds:
 * - command: a backend command or engine step being executed.
 * - info: neutral progress or context information.
 * - success: a step finished successfully.
 * - warn: a non-fatal concern (for example medium-severity evidence).
 * - risk: high-probability suspicious evidence (rendered red).
 * - error: the scan failed.
 */
export const SCAN_EVENT_KINDS = [
  "command",
  "info",
  "success",
  "warn",
  "risk",
  "error",
] as const;
export type ScanEventKind = (typeof SCAN_EVENT_KINDS)[number];

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isoUtc = z.string().regex(ISO_UTC_PATTERN, "Expected an ISO-8601 UTC timestamp.");

export const scanEventSchema = z.strictObject({
  seq: z.number().int().min(1).max(1000000),
  kind: z.enum(SCAN_EVENT_KINDS),
  text: z.string().min(1).max(500),
  createdAt: isoUtc,
});
export type ScanEvent = z.infer<typeof scanEventSchema>;

/** Input contract before persistence assigns a sequence number. */
export const scanEventInputSchema = scanEventSchema.omit({ seq: true });

/** An event before persistence assigns its sequence number. */
export type ScanEventInput = {
  kind: ScanEventKind;
  text: string;
  createdAt: string;
};
