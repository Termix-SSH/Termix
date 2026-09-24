import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { LiveSessions } from "./live.js";
import type { RateLimiter } from "./rate-limit.js";
import type {
  Directory,
  RoomRepository,
  ShareRepository,
} from "./repositories.js";
import type { CollabRoomHub } from "./room-hub.js";
import type { CollabRuntimeStore } from "./runtime-store.js";

/** Everything the routes and services share, built once in activate. */
export interface SharingDeps {
  ctx: PluginContext;
  shares: ShareRepository;
  rooms: RoomRepository;
  directory: Directory;
  live: LiveSessions;
  hub: CollabRoomHub;
  store: CollabRuntimeStore;
  /** /resolve/:linkToken, 30 a minute per IP. */
  resolveLimiter: RateLimiter;
  /** Room guest links, 60 a minute per IP. */
  guestLimiter: RateLimiter;
  isSharingEnabledForHost: (hostId: number) => Promise<boolean>;
}

export const PROTOCOLS = ["ssh", "rdp", "vnc", "telnet"] as const;

/** Where SSH shares are joined: the terminal's own socket. */
export const TERMINAL_WS_PATH = "/plugin-ws/ssh-terminal/terminal";
/** Where remote desktop viewers connect. */
export const DISPLAY_WS_PATH = "/plugin-ws/remote-desktop/display";

export function clientIp(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The acting user, which core set from the authenticated request. */
export function actorOf(ctx: PluginContext): string {
  const userId = ctx.currentActor();
  if (!userId) throw new Error("No acting user");
  return userId;
}
