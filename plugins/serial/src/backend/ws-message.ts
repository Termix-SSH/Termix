import type { RawData } from "ws";

// Control messages here are tiny (a path, a baud rate) or raw terminal input,
// bounded by what a user can type or paste, so anything larger is abuse.
const MAX_MESSAGE_BYTES = 1024 * 1024;

function rawByteLength(raw: RawData): number {
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw))
    return raw.reduce((sum, part) => sum + part.length, 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return 0;
}

/** Parses a WebSocket frame into `{ type, data }`, throwing on anything malformed. */
export function parseWsMessage(raw: RawData): { type: string; data: unknown } {
  if (rawByteLength(raw) > MAX_MESSAGE_BYTES) {
    throw new Error("Message too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    throw new Error("Invalid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Message must be a JSON object");
  }

  const { type, data } = parsed as { type?: unknown; data?: unknown };
  if (typeof type !== "string") {
    throw new Error("Message type must be a string");
  }

  return { type, data };
}
