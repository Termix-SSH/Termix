import type { TermixApp } from "@termix/plugin-sdk/frontend";
import type { ProxmoxDiscoverResult } from "./types";

let current: TermixApp | null = null;

/** Set in activate, cleared on deactivate. */
export function setProxmoxApp(app: TermixApp | null): void {
  current = app;
}

function app(): TermixApp {
  if (!current) throw new Error("The Proxmox plugin is not active");
  return current;
}

/**
 * Runs a guest discovery over the server-sent event stream and reports
 * progress. Returns a function that stops listening.
 */
export function discoverProxmoxGuestsStream(
  hostId: number,
  handlers: {
    onProgress?: (done: number, total: number) => void;
    onResult: (result: ProxmoxDiscoverResult) => void;
    onError: (message: string) => void;
  },
): () => void {
  const controller = new AbortController();
  let settled = false;
  const finish = () => {
    settled = true;
    controller.abort();
  };

  const handleEvent = (event: string, data: string) => {
    if (event === "progress") {
      try {
        const parsed = JSON.parse(data);
        handlers.onProgress?.(parsed.done, parsed.total);
      } catch {
        // ignore malformed progress frames
      }
    } else if (event === "result") {
      finish();
      try {
        handlers.onResult(JSON.parse(data));
      } catch {
        handlers.onError("Failed to parse discovery result");
      }
    } else if (event === "fail") {
      finish();
      let message = "Discovery failed";
      try {
        message = JSON.parse(data).message || message;
      } catch {
        // keep default message
      }
      handlers.onError(message);
    }
  };

  void (async () => {
    try {
      const response = await app().fetch(
        `/discover/stream?hostId=${encodeURIComponent(String(hostId))}`,
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error("stream failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trim());
          }
          if (data.length) handleEvent(event, data.join("\n"));
          split = buffer.indexOf("\n\n");
        }
      }
      if (!settled) {
        settled = true;
        handlers.onError("Discovery connection lost");
      }
    } catch {
      if (settled) return;
      settled = true;
      handlers.onError("Discovery connection lost");
    }
  })();

  return finish;
}

export interface ProxmoxImportResult {
  success: number;
  failed: number;
  errors: string[];
}

export async function importProxmoxHosts(
  hosts: Record<string, unknown>[],
): Promise<ProxmoxImportResult> {
  const response = await app().api.post<ProxmoxImportResult>("/import", {
    hosts,
  });
  return response.data;
}
