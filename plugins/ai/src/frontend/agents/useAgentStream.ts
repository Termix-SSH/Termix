import { useEffect, useRef, useState } from "react";
import { aiApp } from "../app-ref";
import type { AgentEvent, AgentSession } from "../../backend/agents/types";

export function useAgentStream(
  id: string | undefined,
  generation: number,
  snapshot: (s: AgentSession) => void,
  event: (e: AgentEvent) => void,
) {
  const callbacks = useRef({ snapshot, event });
  callbacks.current = { snapshot, event };
  const [connection, setConnection] = useState("connected");
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cursor = 0,
      attempt = 0;
    const refresh = async () => {
      const r = await aiApp().api.get<AgentSession>(`/agents/${id}`);
      if (controller.signal.aborted) return;
      cursor = Math.max(cursor, r.data.events.at(-1)?.seq ?? 0);
      callbacks.current.snapshot(r.data);
      return r.data;
    };
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const s = await refresh();
          if (!s || controller.signal.aborted) return;
          if (s.status === "stopped") {
            setConnection("connected");
            return;
          }
          const response = await aiApp().fetch(
            `agents/${id}/events?after=${cursor}`,
            { signal: controller.signal },
          );
          if ([401, 403, 404].includes(response.status)) {
            setConnection("unavailable");
            return;
          }
          if (!response.ok || !response.body) throw Error("Stream unavailable");
          setConnection("connected");
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          try {
            while (!controller.signal.aborted) {
              const result = await reader.read();
              if (result.done) break;
              attempt = 0;
              buffer += decoder.decode(result.value, { stream: true });
              let end: number;
              while ((end = buffer.indexOf("\n\n")) >= 0) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const line = frame
                  .split("\n")
                  .find((l) => l.startsWith("data: "));
                if (!line) continue;
                if (frame.includes("event: snapshot")) {
                  await refresh();
                  return;
                }
                const e: AgentEvent = JSON.parse(line.slice(6));
                if (e.seq <= cursor) continue;
                cursor = e.seq;
                callbacks.current.event(e);
                if (e.kind === "state" || e.kind === "error") await refresh();
                if (e.kind === "status" && e.text === "stopped") return;
              }
            }
          } finally {
            await reader.cancel().catch(() => undefined);
          }
        } catch (error) {
          const status = (error as { response?: { status?: number } }).response
            ?.status;
          if ([400, 401, 403, 404].includes(status ?? 0)) {
            setConnection("unavailable");
            return;
          }
        }
        if (controller.signal.aborted) return;
        setConnection("reconnecting");
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(
            done,
            Math.min(1000 * 2 ** attempt++, 10000),
          );
          controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    })();
    return () => controller.abort();
  }, [id, generation]);
  return connection;
}
