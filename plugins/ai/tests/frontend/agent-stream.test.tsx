import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAgentStream } from "../../src/frontend/agents/useAgentStream";
const api = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("../../src/frontend/app-ref", () => ({
  aiApp: () => ({ api, fetch: api.fetch }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("restores a snapshot after an EOF and resumes after its last sequence", async () => {
  api.get
    .mockResolvedValueOnce({
      data: {
        id: "x",
        status: "running",
        events: [{ seq: 1, kind: "user", text: "hi" }],
      },
    })
    .mockResolvedValue({
      data: {
        id: "x",
        status: "running",
        events: [
          { seq: 1, kind: "user", text: "hi" },
          { seq: 2, kind: "text", text: "recovered" },
        ],
      },
    });
  api.fetch.mockResolvedValueOnce(new Response(""));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  api.fetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            stream = c;
          },
        }),
      ),
  );
  const snapshot = vi.fn(),
    event = vi.fn();
  const { result, unmount } = renderHook(() =>
    useAgentStream("x", 0, snapshot, event),
  );
  await waitFor(() => expect(result.current).toBe("reconnecting"));
  await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2), {
    timeout: 2500,
  });
  expect(api.fetch.mock.calls[1][0]).toBe("agents/x/events?after=2");
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode(
        'data: {"seq":2,"kind":"text","text":"duplicate"}\n\ndata: {"seq":3,"kind":"text","text":"new"}\n\n',
      ),
    );
  });
  expect(event).toHaveBeenCalledTimes(1);
  expect(event).toHaveBeenCalledWith({ seq: 3, kind: "text", text: "new" });
  expect(snapshot.mock.lastCall?.[0].events[1].text).toBe("recovered");
  unmount();
  stream.close();
});
it("does not reconnect an inaccessible session", async () => {
  api.get.mockRejectedValue({ response: { status: 403 } });
  const { result } = renderHook(() => useAgentStream("x", 0, vi.fn(), vi.fn()));
  await waitFor(() => expect(result.current).toBe("unavailable"));
  expect(api.fetch).not.toHaveBeenCalled();
});
