import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  attachOrCreateTmuxSession,
  detectTmux,
  waitForTmuxSession,
  type TmuxDetectionResult,
} from "./tmux-commands.js";

export type TmuxDetection = TmuxDetectionResult;

/**
 * What the terminal (ssh-terminal's optional "tmux.sessions" consumer) asks
 * of this plugin. Clients and streams cross the service boundary as
 * `unknown`, since the SDK types services without an ssh2 dependency.
 */
export interface TmuxSessionsV1 {
  detect: (client: unknown) => Promise<TmuxDetection>;
  attachOrCreate: (
    stream: unknown,
    name?: string,
    newName?: string,
    hostId?: number,
  ) => Promise<void>;
  waitForSession: (client: unknown, name: string) => Promise<string>;
}

export function createTmuxSessionsService(ctx: PluginContext): TmuxSessionsV1 {
  return {
    detect(client) {
      return detectTmux(client as Client);
    },

    async attachOrCreate(stream, name, newName, hostId) {
      const mouseEnabled =
        hostId === undefined ||
        (await ctx.settings.getHost<boolean>(hostId, "mouseEnabled")) !== false;
      attachOrCreateTmuxSession(
        stream as ClientChannel,
        name,
        newName,
        mouseEnabled,
      );
    },

    async waitForSession(client, name) {
      const confirmed = await waitForTmuxSession(client as Client, name);
      if (!confirmed) {
        ctx.log.warn(
          `Timed out waiting for a new tmux session to appear: ${name}`,
        );
        return name;
      }
      return confirmed;
    },
  };
}
