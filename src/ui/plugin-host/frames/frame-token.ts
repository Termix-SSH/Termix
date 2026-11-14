/**
 * Short tokens a plugin's frames use on its own routes. One per plugin,
 * shared by all its frames, renewed before it runs out. Plugins that ask in
 * the same moment (every frame on a page load) share one request.
 */

import { authApi } from "@/main-axios";

interface Token {
  value: string;
  expiresAt: number;
}

const tokens = new Map<string, Token>();
const pending = new Map<string, Promise<Token>>();

/** Renew when less than this is left, so a frame never holds a dead one. */
const RENEW_BEFORE_MS = 90_000;
/** How long asks are gathered before one request goes out. */
const GATHER_MS = 25;

type Waiter = { resolve: (token: Token) => void; reject: (e: Error) => void };
let queued = new Map<string, Waiter>();
let timer: ReturnType<typeof setTimeout> | null = null;

function toToken(data: unknown): Token {
  const entry = data as { token?: unknown; expiresIn?: unknown } | undefined;
  if (typeof entry?.token !== "string") throw new Error("No frame token");
  const seconds = Number(entry.expiresIn) || 300;
  return { value: entry.token, expiresAt: Date.now() + seconds * 1000 };
}

async function flush(): Promise<void> {
  const batch = queued;
  queued = new Map();
  timer = null;
  try {
    const response = await authApi.post("/plugins/frame-tokens", {
      ids: [...batch.keys()],
    });
    const found = ((response.data as { tokens?: unknown })?.tokens ??
      {}) as Record<string, unknown>;
    for (const [pluginId, waiter] of batch) {
      try {
        const token = toToken(found[pluginId]);
        tokens.set(pluginId, token);
        waiter.resolve(token);
      } catch (error) {
        waiter.reject(error as Error);
      }
    }
  } catch (error) {
    for (const waiter of batch.values()) waiter.reject(error as Error);
  }
}

export function frameToken(pluginId: string): Promise<Token> {
  const current = tokens.get(pluginId);
  if (current && current.expiresAt - Date.now() > RENEW_BEFORE_MS) {
    return Promise.resolve(current);
  }
  let request = pending.get(pluginId);
  if (!request) {
    request = new Promise<Token>((resolve, reject) => {
      queued.set(pluginId, { resolve, reject });
      timer ??= setTimeout(() => void flush(), GATHER_MS);
    }).finally(() => pending.delete(pluginId));
    pending.set(pluginId, request);
  }
  return request;
}

/** Forgets a plugin's token, on disable and logout. */
export function dropFrameToken(pluginId?: string): void {
  if (pluginId) tokens.delete(pluginId);
  else tokens.clear();
}
