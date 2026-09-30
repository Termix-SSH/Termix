import { randomUUID } from "node:crypto";
import type { Client } from "ssh2";
import type { WebSocket } from "ws";
import type {
  PluginContext,
  PluginSshConnection,
} from "@termix/plugin-sdk/backend";
import { createC2SPrompt } from "./c2s-auth.js";

/** A desktop runtime holds one authenticated SSH connection across SOCKS streams. */
export function createC2SConnections(ctx: PluginContext) {
  type Entry = {
    sockets: Set<WebSocket>;
    source: Promise<PluginSshConnection<Client>>;
  };
  const entries = new Map<string, Entry>();
  ctx.disposables.add(() => {
    for (const entry of entries.values())
      for (const ws of entry.sockets) ws.close();
    entries.clear();
  });
  return async (ws: WebSocket, hostId: number, sessionId?: string) => {
    if (ws.readyState !== 1) throw new Error("Tunnel closed");
    const key = JSON.stringify([
      ctx.currentActor(),
      hostId,
      typeof sessionId === "string" && sessionId.length <= 128
        ? sessionId
        : randomUUID(),
    ]);
    let entry = entries.get(key);
    if (!entry) {
      const source = ctx.ssh.connect<Client>(hostId, {
        purpose: "tunnel",
        profile: "forward",
        timeoutMs: 60_000,
        prompt: createC2SPrompt(ws),
      });
      entry = { sockets: new Set(), source };
      entries.set(key, entry);
      const own = entry;
      void source.then(
        (connection) => {
          const close = () => {
            if (entries.get(key) === own) entries.delete(key);
            for (const socket of own.sockets) socket.close();
          };
          connection.client.once("close", close);
          connection.client.once("error", close);
        },
        () => {
          if (entries.get(key) === own) entries.delete(key);
          for (const socket of own.sockets) {
            if (socket.readyState === 1)
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: "Endpoint SSH authentication failed",
                }),
              );
            socket.close();
          }
        },
      );
    }
    const own = entry;
    own.sockets.add(ws);
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      ws.off("close", dispose);
      ws.off("error", dispose);
      own.sockets.delete(ws);
      if (!own.sockets.size) {
        if (entries.get(key) === own) entries.delete(key);
        void own.source.then(
          (source) => source.dispose(),
          () => {},
        );
      }
    };
    ws.once("close", dispose);
    ws.once("error", dispose);
    try {
      const source = await own.source;
      if (released || ws.readyState !== 1) throw new Error("Tunnel closed");
      return { ...source, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  };
}
