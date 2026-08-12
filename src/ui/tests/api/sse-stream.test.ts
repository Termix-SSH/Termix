import { describe, expect, it, vi } from "vitest";
import { streamServerSentEvents } from "@/api/sse-stream";

describe("streamServerSentEvents", () => {
  it("sends the supplied authentication options and parses split events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: stat"));
        controller.enqueue(
          new TextEncoder().encode(
            'uses\ndata: {"tunnel":{"status":"connected"}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(stream, { status: 200 }));
    const onEvent = vi.fn();
    const headers = new Headers({ Authorization: "Bearer token" });

    await streamServerSentEvents(
      "http://localhost/stream",
      { credentials: "include", headers },
      onEvent,
    );

    expect(fetchMock).toHaveBeenCalledWith("http://localhost/stream", {
      credentials: "include",
      headers,
    });
    expect(onEvent).toHaveBeenCalledWith({
      event: "statuses",
      data: '{"tunnel":{"status":"connected"}}',
    });
  });

  it("rejects an unauthorized stream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(
      streamServerSentEvents("http://localhost/stream", {}, vi.fn()),
    ).rejects.toThrow("status 401");
  });
});
