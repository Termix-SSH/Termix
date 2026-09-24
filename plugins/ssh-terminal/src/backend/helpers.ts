import dns from "dns/promises";
import net from "net";
import type { RawData } from "ws";
import ssh2Pkg, {
  type GetStreamCallback,
  type IdentityCallback,
  type ParsedKey,
  type SignCallback,
  type SigningRequestOptions,
} from "ssh2";
import type { PluginLogger } from "@termix/plugin-sdk/backend";

const { AgentProtocol, BaseAgent } = ssh2Pkg;

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return error instanceof Error ? error.message : fallback;
}

/** The terminal's structured logging, on top of ctx.log. */
export interface TerminalLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  success: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (
    message: string,
    error?: unknown,
    meta?: Record<string, unknown>,
  ) => void;
}

function withMeta(message: string, meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return message;
  try {
    return `${message} ${JSON.stringify(meta)}`;
  } catch {
    return message;
  }
}

export function createTerminalLogger(log: PluginLogger): TerminalLogger {
  return {
    info: (message, meta) => log.info(withMeta(message, meta)),
    success: (message, meta) => log.info(withMeta(message, meta)),
    warn: (message, meta) => log.warn(withMeta(message, meta)),
    error: (message, error, meta) => {
      // Some call sites pass the meta object where the error goes.
      if (error && !(error instanceof Error) && typeof error === "object") {
        log.error(withMeta(message, error as Record<string, unknown>));
        return;
      }
      log.error(
        withMeta(message, meta),
        error instanceof Error
          ? error
          : error
            ? new Error(String(error))
            : undefined,
      );
    },
  };
}

// Cap on a single decoded text frame. Legitimate control messages are tiny,
// and terminal input is bounded by what a user can type or paste.
export const MAX_WS_MESSAGE_BYTES = 1024 * 1024;

export class WsMessageError extends Error {}

function rawByteLength(raw: RawData): number {
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw))
    return raw.reduce((sum, part) => sum + part.length, 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return 0;
}

/** Parses a frame into `{ type, data }`, throwing WsMessageError on anything else. */
export function parseWsMessage(raw: RawData): {
  type: string;
  data: unknown;
} {
  if (rawByteLength(raw) > MAX_WS_MESSAGE_BYTES) {
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

export function isWindowsSftpPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(normalized) || /^\/[A-Za-z]:\//.test(normalized);
}

export function sftpPathToLocalPath(sftpPath: string): string {
  const normalized = sftpPath.replace(/\\/g, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(1).replace(/\//g, "\\");
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.replace(/\//g, "\\");
  }
  return sftpPath;
}

export const SSH_DNS_RETRY_DELAYS_MS = [250, 750, 1500];

type Lookup = typeof dns.lookup;
type Sleep = (ms: number) => Promise<void>;
const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetriableDnsError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown };
  return (
    err.code === "EAI_AGAIN" ||
    (typeof err.message === "string" && err.message.includes("EAI_AGAIN"))
  );
}

/** Resolves a hostname up front, retrying transient container DNS failures. */
export async function resolveHostForSshConnect(
  host: string,
  lookup: Lookup = dns.lookup,
  retryDelaysMs = SSH_DNS_RETRY_DELAYS_MS,
  wait: Sleep = sleep,
): Promise<{ host: string; resolvedAddress?: string; attempts: number }> {
  const normalized = host.replace(/^\[|\]$/g, "").trim();
  if (!normalized || net.isIP(normalized) !== 0) {
    return { host: normalized || host, attempts: 0 };
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await lookup(normalized);
      return {
        host: result.address,
        resolvedAddress: result.address,
        attempts: attempt + 1,
      };
    } catch (error) {
      if (!isRetriableDnsError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      await wait(retryDelaysMs[attempt]);
    }
  }
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

export function resolveServerJumpHosts(
  clientJumpHosts: Array<{ hostId: number }> | undefined,
  serverJumpHosts: Array<{ hostId: number }> | undefined,
  hostSyncId?: string | null,
): Array<{ hostId: number }> | undefined {
  if (hostSyncId) return serverJumpHosts ?? [];
  return clientJumpHosts?.length ? clientJumpHosts : serverJumpHosts;
}

export function resolveServerHostId(
  clientHostId: number | null,
  resolvedHost: { id?: unknown } | null,
): number | null {
  return typeof resolvedHost?.id === "number" ? resolvedHost.id : clientHostId;
}

/** An in-memory SSH agent holding one key, for agent forwarding. */
export class MemoryAgent extends BaseAgent {
  private key: ParsedKey;

  constructor(key: ParsedKey) {
    super();
    this.key = key;
  }

  getIdentities(cb: IdentityCallback<ParsedKey>): void {
    cb(null, [this.key]);
  }

  getStream(cb: GetStreamCallback): void {
    const protocol = new AgentProtocol(false);

    protocol.on("identities", (request) => {
      protocol.getIdentitiesReply(request, [this.key]);
    });

    protocol.on("sign", (request, publicKey, data, options) => {
      this.sign(publicKey, data, options, (error, signature) => {
        if (error || !signature) return protocol.failureReply(request);
        protocol.signReply(request, signature);
      });
    });

    cb(null, protocol);
  }

  sign(
    _pubKey: ParsedKey | Buffer | string,
    data: Buffer,
    optionsOrCb: SigningRequestOptions | SignCallback,
    cb?: SignCallback,
  ): void {
    const callback = typeof optionsOrCb === "function" ? optionsOrCb : cb!;
    const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
    try {
      const algo =
        options.hash === "sha256"
          ? "rsa-sha2-256"
          : options.hash === "sha512"
            ? "rsa-sha2-512"
            : undefined;
      const signature = this.key.sign(data, algo);
      callback(null, signature);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
