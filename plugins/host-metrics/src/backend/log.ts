import type { PluginLogger } from "@termix/plugin-sdk/backend";

export type Meta = Record<string, unknown>;

export interface MetricsLogger {
  debug: (message: string, meta?: Meta) => void;
  info: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  /** An error, or structured context, or both. */
  error: (message: string, errorOrMeta?: unknown, meta?: Meta) => void;
}

function withMeta(message: string, meta?: Meta): string {
  return meta && Object.keys(meta).length > 0
    ? `${message} ${JSON.stringify(meta)}`
    : message;
}

/** ctx.log with the structured context the old stats logger carried. */
export function createLogger(log: PluginLogger): MetricsLogger {
  return {
    debug: (message, meta) => log.debug(withMeta(message, meta)),
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
