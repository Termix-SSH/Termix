import type { RawData } from "ws";

// Cap on a single decoded text frame. Anything larger is almost certainly
// abuse - the legitimate control messages here are tiny, and terminal input is
// bounded by what a user can type or paste.
const MAX_MESSAGE_BYTES = 1024 * 1024;

export class WsMessageError extends Error {}

function rawByteLength(raw: RawData): number {
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw))
    return raw.reduce((sum, part) => sum + part.length, 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return 0;
}

/**
 * Parse a WebSocket frame into a plain message object.
 *
 * Throws WsMessageError - never a TypeError - for anything malformed, so
 * callers can reject the frame instead of the parse blowing up the handler.
 * `JSON.parse` happily returns null, numbers and arrays, none of which are
 * safe to destructure, so the shape is checked here rather than at each site.
 */
export function parseWsMessage(raw: RawData): {
  type: string;
  data: unknown;
} {
  if (rawByteLength(raw) > MAX_MESSAGE_BYTES) {
    throw new WsMessageError("Message too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    throw new WsMessageError("Invalid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WsMessageError("Message must be a JSON object");
  }

  const { type, data } = parsed as { type?: unknown; data?: unknown };
  if (typeof type !== "string") {
    throw new WsMessageError("Message type must be a string");
  }

  return { type, data };
}

/** Narrow unknown payload data to a plain object without throwing. */
export function asObject(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** Narrow unknown payload data to a string without throwing. */
export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Coerce a client-supplied terminal width/height to a sane integer.
 * Returns 0 when the value is unusable, so callers can skip the resize
 * rather than pass NaN or a negative into ssh2's setWindow.
 */
export function toTerminalDimension(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.floor(n);
  if (rounded < 1) return 0;
  return Math.min(rounded, 10000);
}
