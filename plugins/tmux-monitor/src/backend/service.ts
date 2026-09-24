import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  attachOrCreateTmuxSession,
  detectTmux,
  waitForTmuxSession,
} from "./tmux-commands.js";

export interface TmuxDetection {
  available: boolean;
  sessions: string[];
}

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
  ) => Promise<void>;
  waitForSession: (client: unknown, name: string) => Promise<string>;
}

export function createTmuxSessionsService(ctx: PluginContext): TmuxSessionsV1 {
  return {
    async detect(client) {
      const result = await detectTmux(client as Client);
      return {
        available: result.available,
        sessions: result.sessions.map((s) => s.name),
      };
    },

    async attachOrCreate(stream, name, newName) {
      attachOrCreateTmuxSession(stream as ClientChannel, name, newName);
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
