import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mergeTunnelStatuses,
  parseServerSentEvents,
  setTunnelsApi,
  subscribeTunnelStatuses,
} from "../../src/frontend/api";

afterEach(() => {
  setTunnelsApi(null);
});

describe("mergeTunnelStatuses", () => {
  it("keeps local state when a remote tunnel with the same name differs", () => {
    // Controls always target the local backend, so its view wins.
    expect(
      mergeTunnelStatuses(
        { shared: { connected: true, status: "connected" } },
        {
          shared: { connected: false, status: "disconnected" },
          remoteOnly: { connected: true, status: "connected" },
        },
      ),
    ).toEqual({
      shared: { connected: true, status: "connected" },
      remoteOnly: { connected: true, status: "connected" },
    });
  });
});

describe("parseServerSentEvents", () => {
  it("splits complete events and hands back a partial one", () => {
    const events: Array<{ event: string; data: string }> = [];
    const rest = parseServerSentEvents(
      ': keepalive\n\nevent: statuses\ndata: {"a":1}\n\nevent: stat',
      (event) => events.push(event),
    );
    expect(events).toEqual([{ event: "statuses", data: '{"a":1}' }]);
    expect(rest).toBe("event: stat");
  });
});

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  });
  return { ok: true, body } as unknown as Response;
}

describe("subscribeTunnelStatuses", () => {
  it("streams statuses from the plugin's event stream and merges remote ones", async () => {
    setTunnelsApi({
      defaults: { baseURL: "http://localhost:30001" },
    } as never);
    const fetchImpl = vi.fn(async (_url: string) =>
      streamOf([
        `event: statuses\ndata: ${JSON.stringify({ shared: { connected: true, status: "connected" } })}\n\n`,
      ]),
    );
    const onStatuses = vi.fn();

    const stop = subscribeTunnelStatuses(onStatuses, undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fetchRemote: async () => ({
        shared: { connected: false, status: "disconnected" },
        remoteOnly: { connected: true, status: "connected" },
      }),
    });

    await vi.waitFor(() =>
      expect(onStatuses).toHaveBeenLastCalledWith({
        shared: { connected: true, status: "connected" },
        remoteOnly: { connected: true, status: "connected" },
      }),
    );
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://localhost:30001/plugin-api/tunnels/status/stream",
    );
    stop();
  });

  it("falls back to polling the status route when there is no stream url", async () => {
    const get = vi.fn(async () => ({
      data: { t: { connected: true, status: "connected" } },
    }));
    setTunnelsApi({ get } as never);
    const onStatuses = vi.fn();

    const stop = subscribeTunnelStatuses(onStatuses);
    await vi.waitFor(() =>
      expect(onStatuses).toHaveBeenCalledWith({
        t: { connected: true, status: "connected" },
      }),
    );
    expect(get).toHaveBeenCalledWith("/status");
    stop();
  });
});
