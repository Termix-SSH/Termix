import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { PluginSshPromptChannel } from "@termix/plugin-sdk/backend";

/** Answers belong to this authenticated socket and one outstanding challenge. */
export function createC2SPrompt(ws: WebSocket): PluginSshPromptChannel {
  return {
    ask(request) {
      if (ws.readyState !== 1)
        return Promise.reject(new Error("Tunnel closed"));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const finish = (answer: string | null, error?: Error) => {
          clearTimeout(timer);
          ws.off("message", onMessage);
          ws.off("close", onClose);
          ws.off("error", onClose);
          if (error) reject(error);
          else resolve(answer);
        };
        const onClose = () =>
          finish(null, new Error("Tunnel authentication cancelled"));
        const onMessage = (raw: Buffer, binary: boolean) => {
          if (binary) return;
          let value;
          try {
            value = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (value.type !== "auth-response" || value.requestId !== requestId)
            return;
          if (value.answer === null) {
            onClose();
            ws.close();
          } else if (
            typeof value.answer === "string" &&
            value.answer.length <= 8192
          )
            finish(value.answer);
        };
        const timer = setTimeout(() => {
          finish(null, new Error("Tunnel authentication timed out"));
          ws.close();
        }, 60_000);
        ws.on("message", onMessage);
        ws.once("close", onClose);
        ws.once("error", onClose);
        ws.send(JSON.stringify({ type: "auth-prompt", requestId, request }));
      });
    },
  };
}
