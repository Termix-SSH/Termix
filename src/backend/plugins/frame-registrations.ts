/**
 * The server copy of what framed plugins register, so a new browser or device
 * replays it at boot instead of starting every plugin's frame to find out.
 * Only registrations and live keys are kept, never answers or values, which
 * can hold host data. One row per user, client kind and plugin, since a
 * plugin may register differently on the desktop app.
 */

export const FRAME_CLIENTS = ["web", "desktop"] as const;
export type FrameClient = (typeof FRAME_CLIENTS)[number];

export interface StoredRegistration {
  rid: string;
  kind: string;
  raw: unknown;
}

export interface StoredFrameEntry {
  version: string;
  live: string[];
  registrations: StoredRegistration[];
}

/** Under MySQL's 64 KB text column. A bigger plugin just boots its frame. */
export const MAX_ENTRY_BYTES = 60_000;
/** Entries one save may carry. */
export const MAX_ENTRIES = 300;
const MAX_REGISTRATIONS = 500;
const MAX_LIVE = 100;
const MAX_TEXT = 200;

export function isFrameClient(value: unknown): value is FrameClient {
  return (FRAME_CLIENTS as readonly unknown[]).includes(value);
}

export const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;

/** A clean copy of one entry as JSON, or null when it is not one. */
export function cleanEntry(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (!isText(entry.version)) return null;
  if (!Array.isArray(entry.live) || entry.live.length > MAX_LIVE) return null;
  if (!entry.live.every(isText)) return null;
  if (
    !Array.isArray(entry.registrations) ||
    entry.registrations.length > MAX_REGISTRATIONS
  ) {
    return null;
  }
  const registrations: StoredRegistration[] = [];
  for (const item of entry.registrations) {
    if (!item || typeof item !== "object") return null;
    const { rid, kind, raw } = item as Record<string, unknown>;
    if (!isText(rid) || !isText(kind)) return null;
    registrations.push({ rid, kind, raw });
  }
  const text = JSON.stringify({
    version: entry.version,
    live: [...entry.live],
    registrations,
  });
  return text.length > MAX_ENTRY_BYTES ? null : text;
}

/** A stored row read back, or null when it is malformed. */
export function parseEntry(data: string): StoredFrameEntry | null {
  try {
    const text = cleanEntry(JSON.parse(data));
    return text ? (JSON.parse(text) as StoredFrameEntry) : null;
  } catch {
    return null;
  }
}
