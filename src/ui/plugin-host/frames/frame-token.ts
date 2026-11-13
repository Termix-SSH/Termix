/**
 * Short tokens a plugin's frames use on its own routes. One per plugin,
 * shared by all its frames, renewed before it runs out.
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

export function frameToken(pluginId: string): Promise<Token> {
  const current = tokens.get(pluginId);
  if (current && current.expiresAt - Date.now() > RENEW_BEFORE_MS) {
    return Promise.resolve(current);
  }
  let request = pending.get(pluginId);
  if (!request) {
    request = authApi
      .post(`/plugins/${encodeURIComponent(pluginId)}/frame-token`)
      .then((response) => {
        const data = response.data as { token?: unknown; expiresIn?: unknown };
        if (typeof data?.token !== "string") {
          throw new Error("No frame token");
        }
        const seconds = Number(data.expiresIn) || 300;
        const token = {
          value: data.token,
          expiresAt: Date.now() + seconds * 1000,
        };
        tokens.set(pluginId, token);
        return token;
      })
      .finally(() => pending.delete(pluginId));
    pending.set(pluginId, request);
  }
  return request;
}

/** Forgets a plugin's token, on disable and logout. */
export function dropFrameToken(pluginId?: string): void {
  if (pluginId) tokens.delete(pluginId);
  else tokens.clear();
}
