import type { PluginLogger } from "@termix/plugin-sdk/backend";

export type Meta = Record<string, unknown>;

export interface RemoteDesktopLogger {
  info: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  error: (message: string, meta?: Meta) => void;
}

function withMeta(message: string, meta?: Meta): string {
  return meta && Object.keys(meta).length > 0
    ? `${message} ${JSON.stringify(meta)}`
    : message;
}

/** ctx.log with the structured context the old guac logger carried. */
export function createLogger(log: PluginLogger): RemoteDesktopLogger {
  return {
    info: (message, meta) => log.info(withMeta(message, meta)),
    warn: (message, meta) => log.warn(withMeta(message, meta)),
    error: (message, meta) => log.error(withMeta(message, meta)),
  };
}

export function errorMessage(error: unknown, fallback = "Unknown error") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
