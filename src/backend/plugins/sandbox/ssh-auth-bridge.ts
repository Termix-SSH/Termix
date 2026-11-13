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
  keepaliveInterval: "number",
  keepaliveCountMax: "number",
};

/** Hooks core calls synchronously inside ssh2, which can't wait on a process. */
const SYNC_ONLY_HOOKS = ["onBanner", "onKeyboardInteractive"] as const;

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
  for (const hook of SYNC_ONLY_HOOKS) {
    if (typeof raw[hook] === "function") {
      throw new SshAuthBridgeError(
        `${hook} is not available to auth providers in a plugin process yet`,
      );
    }
  }
  const prepare = raw.prepare;
  if (typeof prepare !== "function") {
    throw new SshAuthBridgeError("An SSH auth provider needs prepare");
  }
  const provider: Record<string, unknown> = {};
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
