import type { PluginLogger } from "@termix/plugin-sdk/backend";

export type ConnectionStage =
  | "dns"
  | "tcp"
  | "handshake"
  | "auth"
  | "connected"
  | "connection"
  | "error"
  | "proxy"
  | "jump"
  | "sftp_connecting"
  | "sftp_auth"
  | "sftp_connected";

export type LogEntry = {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  stage: ConnectionStage;
  message: string;
  details?: Record<string, unknown> | string;
};

export function createConnectionLog(
  type: LogEntry["type"],
  stage: ConnectionStage,
  message: string,
  details?: Record<string, unknown>,
): Omit<LogEntry, "id" | "timestamp"> {
  return { type, stage, message, details };
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

export function resolveServerHostId(
  clientHostId: number | null,
  resolvedHost: { id?: unknown } | null,
): number | null {
  return typeof resolvedHost?.id === "number" ? resolvedHost.id : clientHostId;
}

export class HostAddressMismatchError extends Error {
  constructor() {
    super(
      "Host mismatch: this server resolved the selected host to a different machine, so the connection was refused. " +
        "The host ids on this device and on the sync server have drifted apart. " +
        'Set the connection origin to "This device" for this host, or re-run a full sync, then try again.',
    );
    this.name = "HostAddressMismatchError";
  }
}

export class HostNotOnThisServerError extends Error {
  constructor() {
    super(
      "This host does not exist on the sync server, so the connection was refused. " +
        'Run a sync so the server knows about it, or set the connection origin to "This device" for this host.',
    );
    this.name = "HostNotOnThisServerError";
  }
}

type Meta = Record<string, unknown>;

export interface FileLogger {
  info: (message: string, meta?: Meta) => void;
  success: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  error: (message: string, error?: unknown, meta?: Meta) => void;
}

function withMeta(message: string, meta?: Meta): string {
  if (!meta || Object.keys(meta).length === 0) return message;
  try {
    return `${message} ${JSON.stringify(meta)}`;
  } catch {
    return message;
  }
}

/** ctx.log takes a plain message; this keeps the structured fields readable. */
export function createFileLogger(log: PluginLogger): FileLogger {
  return {
    info: (message, meta) => log.info(withMeta(message, meta)),
    success: (message, meta) => log.info(withMeta(message, meta)),
    warn: (message, meta) => log.warn(withMeta(message, meta)),
    error: (message, error, meta) => {
      if (error instanceof Error) {
        log.error(withMeta(message, meta), error);
      } else if (error && typeof error === "object" && !meta) {
        log.error(withMeta(message, error as Meta));
      } else {
        log.error(withMeta(message, meta));
      }
    },
  };
}
