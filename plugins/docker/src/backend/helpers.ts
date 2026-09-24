import type { RawData } from "ws";
import type { PluginLogger } from "@termix/plugin-sdk/backend";

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return error instanceof Error ? error.message : fallback;
}

export type Meta = Record<string, unknown>;

export interface DockerLogger {
  info: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  /** An error, or structured context, or both. */
  error: (message: string, errorOrMeta?: unknown, meta?: Meta) => void;
}

function withMeta(message: string, meta?: Meta): string {
  if (!meta || Object.keys(meta).length === 0) return message;
  try {
    return `${message} ${JSON.stringify(meta)}`;
  } catch {
    return message;
  }
}

/** ctx.log with the structured context the old core logger carried. */
export function createLogger(log: PluginLogger): DockerLogger {
  return {
    info: (message, meta) => log.info(withMeta(message, meta)),
    warn: (message, meta) => log.warn(withMeta(message, meta)),
    error: (message, errorOrMeta, meta) => {
      if (errorOrMeta instanceof Error) {
        log.error(withMeta(message, meta), errorOrMeta);
        return;
      }
      log.error(
        withMeta(message, {
          ...((errorOrMeta as Meta | undefined) ?? {}),
          ...meta,
        }),
      );
    },
  };
}

export type LogLevel = "info" | "success" | "warning" | "error";

/** One line of the connection log the panel shows while connecting. */
export interface ConnectionLogLine {
  type: LogLevel;
  stage: string;
  message: string;
}

export function connectionLog(
  type: LogLevel,
  stage: string,
  message: string,
): ConnectionLogLine {
  return { type, stage, message };
}

export const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export const DOCKER_TIMESTAMP_RE = /^[0-9T:.Z+-]+$/;

// Cap on a single decoded text frame. Control messages are tiny, and console
// input is bounded by what a user can type or paste.
export const MAX_WS_MESSAGE_BYTES = 1024 * 1024;

function rawByteLength(raw: RawData): number {
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw))
    return raw.reduce((sum, part) => sum + part.length, 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return 0;
}

/** Parses a frame into `{ type, data }`, throwing on anything else. */
export function parseWsMessage(raw: RawData): { type: string; data: unknown } {
  if (rawByteLength(raw) > MAX_WS_MESSAGE_BYTES) {
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

export function asObject(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A sane integer width or height, or 0 when the value is unusable. */
export function toTerminalDimension(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.floor(n);
  if (rounded < 1) return 0;
  return Math.min(rounded, 10000);
}

function normalizeHostAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Whether a numeric host id resolved to a different machine than the client
 * meant. Ids from the desktop app and a sync server drift apart, and the
 * resolved row supplies the credentials, so a mismatch must be refused.
 */
export function hostAddressMismatch(
  clientAddress: unknown,
  resolvedAddress: unknown,
): boolean {
  const resolved = normalizeHostAddress(resolvedAddress);
  if (!resolved) return false;
  return resolved !== normalizeHostAddress(clientAddress);
}

export const HOST_ADDRESS_MISMATCH_MESSAGE =
  "Host mismatch: this server resolved the selected host to a different machine, so the connection was refused. " +
  "The host ids on this device and on the sync server have drifted apart. " +
  'Set the connection origin to "This device" for this host, or re-run a full sync, then try again.';

export const HOST_NOT_ON_THIS_SERVER_MESSAGE =
  "This host does not exist on the sync server, so the connection was refused. " +
  'Run a sync so the server knows about it, or set the connection origin to "This device" for this host.';

export function newSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
