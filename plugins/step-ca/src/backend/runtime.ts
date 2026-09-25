import { createClient } from "redis";
import type { PluginContext } from "@termix/plugin-sdk/backend";

export interface CallbackQuery {
  state?: string;
  code?: string;
  error?: string;
  error_description?: string;
}

export interface CallbackResult {
  ok: boolean;
  message: string;
}

const SESSION_TTL_SECONDS = 5 * 60;
const RESULT_TTL_SECONDS = 60;
const CONNECT_RETRY_MS = 15_000;

export type Runtime = ReturnType<typeof createRuntime>;

/**
 * Hands an identity provider callback to the Termix instance that started
 * the sign-in, through Redis when REDIS_URL is set. With one instance, or no
 * Redis, every call is a no-op and the callback is handled locally.
 */
export function createRuntime(ctx: PluginContext) {
  const prefix =
    process.env.TERMIX_STEP_CA_REDIS_PREFIX?.trim() || "termix:step-ca";
  let client: ReturnType<typeof createClient> | null = null;
  let connecting: Promise<boolean> | null = null;
  let nextConnectAttempt = 0;

  const routeKey = (state: string) => `${prefix}:route:${state}`;
  const commandKey = (state: string) => `${prefix}:command:${state}`;
  const resultKey = (state: string) => `${prefix}:result:${state}`;

  function logFailure(operation: string, error: unknown): void {
    ctx.log.warn(
      `Step CA Redis runtime unavailable (${operation}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  async function seal(value: unknown): Promise<string> {
    return ctx.secrets.seal(JSON.stringify(value));
  }

  async function unseal<T>(raw: string): Promise<T | null> {
    const plain = await ctx.secrets.unseal(raw);
    if (!plain) return null;
    try {
      return JSON.parse(plain) as T;
    } catch {
      return null;
    }
  }

  async function connect(url: string): Promise<boolean> {
    try {
      client = createClient({
        url,
        socket: { connectTimeout: 1500, reconnectStrategy: false },
      });
      client.on("error", (error) => logFailure("client", error));
      await client.connect();
      nextConnectAttempt = 0;
      return true;
    } catch (error) {
      nextConnectAttempt = Date.now() + CONNECT_RETRY_MS;
      logFailure("connect", error);
      await client?.disconnect().catch(() => {});
      client = null;
      return false;
    }
  }

  async function ready(): Promise<boolean> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return false;
    if (client?.isReady) return true;
    if (Date.now() < nextConnectAttempt) return false;
    if (connecting) return connecting;
    connecting = connect(url).finally(() => {
      connecting = null;
    });
    return connecting;
  }

  return {
    async register(state: string): Promise<void> {
      if (!(await ready()) || !client) return;
      await client
        .set(routeKey(state), "active", { EX: SESSION_TTL_SECONDS })
        .catch((error) => logFailure("register", error));
    },

    /** Queues a callback for the instance that owns the sign-in. */
    async submit(state: string, query: CallbackQuery): Promise<boolean> {
      if (!(await ready()) || !client) return false;
      try {
        if (!(await client.exists(routeKey(state)))) return false;
        const stored = await client.set(commandKey(state), await seal(query), {
          EX: SESSION_TTL_SECONDS,
          NX: true,
        });
        return stored === "OK";
      } catch (error) {
        logFailure("submit", error);
        return false;
      }
    },

    async takeCommand(state: string): Promise<CallbackQuery | null> {
      if (!(await ready()) || !client) return null;
      try {
        const raw = await client.getDel(commandKey(state));
        return raw ? unseal<CallbackQuery>(raw.toString()) : null;
      } catch (error) {
        logFailure("take_command", error);
        return null;
      }
    },

    async complete(state: string, result: CallbackResult): Promise<void> {
      if (!(await ready()) || !client) return;
      try {
        await client
          .multi()
          .set(resultKey(state), await seal(result), {
            EX: RESULT_TTL_SECONDS,
          })
          .del(routeKey(state))
          .del(commandKey(state))
          .exec();
      } catch (error) {
        logFailure("complete", error);
      }
    },

    async takeResult(state: string): Promise<CallbackResult | null> {
      if (!(await ready()) || !client) return null;
      try {
        const raw = await client.getDel(resultKey(state));
        return raw ? unseal<CallbackResult>(raw.toString()) : null;
      } catch (error) {
        logFailure("take_result", error);
        return null;
      }
    },

    async remove(state: string): Promise<void> {
      if (!(await ready()) || !client) return;
      await client
        .del([routeKey(state), commandKey(state), resultKey(state)])
        .catch((error) => logFailure("remove", error));
    },

    async close(): Promise<void> {
      const current = client;
      client = null;
      if (current?.isOpen) await current.quit().catch(() => {});
    },
  };
}
