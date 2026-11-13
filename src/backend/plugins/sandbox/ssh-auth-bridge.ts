/**
 * SSH auth providers that live in a plugin process. The ssh2 client and the
 * real connect config stay in core: prepare gets a copy without secrets and
 * hands back only the fields below, and a certificate it hands back is
 * applied here to the real client.
 */
import type {
  PluginSshAuthOutcome,
  PluginSshAuthProvider,
} from "@termix-ssh/plugin-sdk/backend";
import { SANDBOX_CERTIFICATE_FIELD } from "@termix-ssh/plugin-sdk/ssh-certs";

type AnyFn = (...args: unknown[]) => unknown;

/** Config fields a plugin process may set, with the type each must have. */
const SETTABLE_FIELDS: Record<string, "string" | "number" | "boolean"> = {
  username: "string",
  password: "string",
  privateKey: "string",
  passphrase: "string",
  tryKeyboard: "boolean",
  readyTimeout: "number",
  timeout: "number",
  keepaliveInterval: "number",
  keepaliveCountMax: "number",
};

const STATIC_FIELDS = [
  "type",
  "labelKey",
  "descriptionKey",
  "fields",
  "credentialType",
  "needsUserInteraction",
  "requiresSecret",
  "supportsBackground",
  "quickConnect",
  "interaction",
] as const;

const MAX_SOCKET_MESSAGE = 64 * 1024;
const LOG_LEVELS = new Set(["info", "warning", "error"]);

const MAX_BANNER = 16 * 1024;

/** A keyboard-interactive round as plain strings. */
export function plainRound(round: unknown) {
  const value = (round ?? {}) as {
    name?: unknown;
    instructions?: unknown;
    prompts?: unknown;
  };
  const prompts = Array.isArray(value.prompts) ? value.prompts : [];
  return {
    name: String(value.name ?? ""),
    instructions: String(value.instructions ?? ""),
    prompts: prompts.map((prompt) => ({
      prompt: String((prompt as { prompt?: unknown })?.prompt ?? ""),
      echo: (prompt as { echo?: unknown })?.echo === true,
    })),
  };
}

function shortText(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function plainDetails(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (typeof item === "string") out[key] = item.slice(0, 2000);
    else if (typeof item === "number" || typeof item === "boolean") {
      out[key] = item;
    }
  }
  return out;
}

/** A banner decision from a plugin process, rebuilt field by field. */
export function readBannerDecision(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const decision = value as Record<string, unknown>;
  const details = plainDetails(decision.details);
  if (decision.action === "hold") {
    const timeoutMs = Number(decision.timeoutMs);
    return {
      action: "hold" as const,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.min(timeoutMs, 30 * 60 * 1000)
          : 60_000,
      message: shortText(decision.message),
      ...(details ? { details } : {}),
    };
  }
  if (decision.action === "release") {
    return { action: "release" as const, ...(details ? { details } : {}) };
  }
  return undefined;
}

/** A keyboard-interactive answer from a plugin process, rebuilt field by field. */
export function readDetection(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const detected = value as Record<string, unknown>;
  const index = Number(detected.promptIndex);
  switch (detected.kind) {
    case "auto":
      return Array.isArray(detected.responses)
        ? {
            kind: "auto" as const,
            responses: detected.responses
              .slice(0, 32)
              .map((item) => shortText(item, 1024)),
          }
        : null;
    case "browser":
      return {
        kind: "browser" as const,
        ...(typeof detected.id === "string"
          ? { id: shortText(detected.id, 100) }
          : {}),
        ...(typeof detected.label === "string"
          ? { label: shortText(detected.label, 100) }
          : {}),
        url:
          typeof detected.url === "string" ? detected.url.slice(0, 4096) : null,
        code: shortText(detected.code, 200),
        instructions: shortText(detected.instructions, 4000),
      };
    case "totp": // plugin-id-ok: the code prompt kind, not the plugin
      return Number.isInteger(index) && index >= 0
        ? { kind: "totp" as const, promptIndex: index } // plugin-id-ok: prompt kind
        : null;
    case "input":
      return Number.isInteger(index) && index >= 0
        ? {
            kind: "input" as const,
            promptIndex: index,
            isPush: detected.isPush === true,
          }
        : null;
    default:
      return null;
  }
}

export class SshAuthBridgeError extends Error {
  readonly code = "SANDBOX_UNSUPPORTED";
}

/** The allowed fields of a config the plugin returned, type checked. */
export function pickSettableConfig(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, type] of Object.entries(SETTABLE_FIELDS)) {
    const item = (value as Record<string, unknown>)[key];
    if (key === "privateKey" && Buffer.isBuffer(item)) out[key] = item;
    else if (typeof item === type) out[key] = item;
  }
  return out;
}

interface SandboxCertificate {
  privateKey: string;
  certificate: string;
  passphrase?: string;
}

export function readSandboxCertificate(
  value: unknown,
): SandboxCertificate | null {
  if (!value || typeof value !== "object") return null;
  const cert = (value as Record<string, unknown>)[SANDBOX_CERTIFICATE_FIELD];
  if (!cert || typeof cert !== "object") return null;
  const { privateKey, certificate, passphrase } = cert as Record<
    string,
    unknown
  >;
  if (typeof privateKey !== "string" || typeof certificate !== "string") {
    return null;
  }
  return {
    privateKey,
    certificate,
    ...(typeof passphrase === "string" ? { passphrase } : {}),
  };
}

/** What a plugin process sees of the config core built so far. */
function visibleConfig(config: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ["host", "port", "username"]) {
    const value = config[key];
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    }
  }
  return out;
}

interface CoreEnv {
  client: unknown;
  userId: string;
  hostId: number;
  purpose: string;
  interactive: boolean;
  log?: (level: "info" | "warning" | "error", message: string) => void;
}

function visibleEnv(env: CoreEnv) {
  return {
    userId: env.userId,
    hostId: env.hostId,
    purpose: env.purpose,
    interactive: env.interactive,
    log: (level: unknown, message: unknown) => {
      const lvl = LOG_LEVELS.has(String(level)) ? String(level) : "info";
      env.log?.(lvl as "info", String(message).slice(0, 2000));
    },
  };
}

interface LiveSocket {
  send?: (data: string) => void;
  on?: (event: string, listener: () => void) => void;
  readyState?: number;
}

/** A sign-in socket as two plain functions. */
function visibleSocket(socket: unknown) {
  const live = (socket ?? {}) as LiveSocket;
  return {
    send: (data: unknown) => {
      if (typeof data !== "string" || data.length > MAX_SOCKET_MESSAGE) return;
      if (live.readyState !== undefined && live.readyState !== 1) return;
      live.send?.(data);
    },
    onClose: (listener: unknown) => {
      if (typeof listener !== "function") return;
      live.on?.("close", () => {
        void Promise.resolve((listener as AnyFn)()).catch(() => undefined);
      });
    },
  };
}

export interface RemoteProviderDeps {
  /** Host record as the plugin may see it (secrets removed without credentials:read). */
  visibleHost: (host: unknown) => Promise<unknown>;
  applyCertificate: (
    config: Record<string, unknown>,
    client: unknown,
    cert: SandboxCertificate,
    username: string,
  ) => Promise<void>;
}

/**
 * Builds the provider core registers for one a plugin process sent. Its
 * functions are calls into that process.
 */
export function remoteSshAuthProvider(
  raw: Record<string, unknown>,
  deps: RemoteProviderDeps,
): PluginSshAuthProvider {
  const prepare = raw.prepare;
  if (typeof prepare !== "function") {
    throw new SshAuthBridgeError("An SSH auth provider needs prepare");
  }
  // Its hooks answer with Promises; core's sync classifier skips it.
  const provider: Record<string, unknown> = { remote: true };
  for (const key of STATIC_FIELDS) {
    if (raw[key] !== undefined) provider[key] = raw[key];
  }

  provider.prepare = async (
    config: Record<string, unknown>,
    host: unknown,
    env: CoreEnv,
  ): Promise<PluginSshAuthOutcome> => {
    const answer = (await (prepare as AnyFn)(
      visibleConfig(config),
      await deps.visibleHost(host),
      visibleEnv(env),
    )) as { outcome?: PluginSshAuthOutcome; config?: unknown } | undefined;
    const outcome = answer?.outcome;
    if (!outcome || typeof outcome !== "object") {
      return {
        status: "error",
        code: "failed",
        message: "The auth provider gave no answer",
      };
    }
    const returned = pickSettableConfig(answer?.config);
    const cert = readSandboxCertificate(answer?.config);
    Object.assign(config, returned);
    if (cert && outcome.status === "ready") {
      try {
        await deps.applyCertificate(
          config,
          env.client,
          cert,
          typeof returned.username === "string"
            ? returned.username
            : String(config.username ?? ""),
        );
      } catch (error) {
        return {
          status: "error",
          code: "failed",
          message:
            "Certificate authentication failed: " +
            (error instanceof Error ? error.message : String(error)),
        };
      }
    }
    return outcome;
  };

  if (typeof raw.connectOptions === "function") {
    const connectOptions = raw.connectOptions as AnyFn;
    provider.connectOptions = async (host: unknown, purpose: string) =>
      pickSettableConfig(
        await connectOptions(await deps.visibleHost(host), purpose),
      );
  }

  if (typeof raw.onAuthFailed === "function") {
    const onAuthFailed = raw.onAuthFailed as AnyFn;
    provider.onAuthFailed = async (
      host: unknown,
      env: CoreEnv,
      context: {
        error: Error;
        retries: number;
        canRetry: boolean;
        methodNotAvailable: boolean;
      },
    ) => {
      const answer = (await onAuthFailed(
        await deps.visibleHost(host),
        visibleEnv(env),
        {
          error: new Error(context.error?.message ?? "Authentication failed"),
          retries: context.retries,
          canRetry: context.canRetry,
          methodNotAvailable: context.methodNotAvailable,
        },
      )) as PluginSshAuthOutcome | undefined | null;
      if (!answer || typeof answer !== "object") return undefined;
      // A retry patches the live config, so it gets the same field list.
      if (answer.status === "retry") {
        return {
          ...answer,
          patch: pickSettableConfig((answer as { patch?: unknown }).patch),
        } as PluginSshAuthOutcome;
      }
      return answer;
    };
  }

  if (typeof raw.onBanner === "function") {
    const onBanner = raw.onBanner as AnyFn;
    provider.onBanner = async (banner: unknown, host: unknown, env: CoreEnv) =>
      readBannerDecision(
        await onBanner(
          String(banner).slice(0, MAX_BANNER),
          await deps.visibleHost(host),
          visibleEnv(env),
        ),
      );
  }

  if (typeof raw.onKeyboardInteractive === "function") {
    const detect = raw.onKeyboardInteractive as AnyFn;
    provider.onKeyboardInteractive = async (round: unknown, host: unknown) =>
      readDetection(
        await detect(plainRound(round), await deps.visibleHost(host)),
      );
  }

  if (typeof raw.startInteraction === "function") {
    const startInteraction = raw.startInteraction as AnyFn;
    provider.startInteraction = async (request: {
      userId: string;
      hostId: number;
      host: { name?: string | null; ip: string; username: string };
      socket: unknown;
      requestOrigin: string;
      payload: Record<string, unknown>;
    }) => {
      await startInteraction({
        userId: request.userId,
        hostId: request.hostId,
        host: {
          name: request.host?.name ?? null,
          ip: request.host?.ip,
          username: request.host?.username,
        },
        requestOrigin: request.requestOrigin,
        payload: request.payload ?? {},
        socket: visibleSocket(request.socket),
      });
    };
  }

  if (typeof raw.cancelInteraction === "function") {
    const cancelInteraction = raw.cancelInteraction as AnyFn;
    provider.cancelInteraction = async (request: {
      userId: string;
      hostId?: number;
      requestId?: string;
    }) => {
      await cancelInteraction({
        userId: request.userId,
        ...(request.hostId !== undefined ? { hostId: request.hostId } : {}),
        ...(request.requestId !== undefined
          ? { requestId: request.requestId }
          : {}),
      });
    };
  }

  return provider as unknown as PluginSshAuthProvider;
}
