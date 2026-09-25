import { describe, expect, it, vi } from "vitest";
import {
  createAlertsStore,
  parseServerSentEvents,
} from "../../src/frontend/store";
import { shouldPopUp } from "../../src/frontend/popups";
import {
  configFrom,
  parseHeaders,
  EMPTY,
} from "../../src/frontend/channel-config";
import type { AlertItem } from "../../src/types";

function item(id: number, severity: AlertItem["severity"]): AlertItem {
  return {
    id,
    source: "docker",
    category: "docker",
    severity,
    title: `alert ${id}`,
    body: null,
    link: null,
    context: null,
    deliveries: null,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
}

/** A response whose body streams the given chunks, then stays open. */
function streaming(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("parseServerSentEvents", () => {
  it("parses whole events and keeps the rest for later", () => {
    const events: Array<{ event: string; data: string }> = [];
    const rest = parseServerSentEvents(
      'event: unread\ndata: {"count":2}\n\n: keepalive\n\nevent: item\ndata: {"id"',
      (event) => events.push(event),
    );
    expect(events).toEqual([{ event: "unread", data: '{"count":2}' }]);
    expect(rest).toBe('event: item\ndata: {"id"');
  });
});

describe("createAlertsStore", () => {
  it("follows the unread count and hands on each alert once as new", async () => {
    const first = item(7, "critical");
    const store = createAlertsStore({
      connect: async () =>
        streaming([
          'event: unread\ndata: {"count":3}\n\n',
          `event: item\ndata: ${JSON.stringify(first)}\n\n`,
          `event: item\ndata: ${JSON.stringify({ ...first, deliveries: [] })}\n\n`,
        ]),
      loadUnread: async () => 0,
    });
    const seen: Array<[number, boolean]> = [];
    store.onItem((alert, isNew) => seen.push([alert.id, isNew]));

    store.start();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    store.stop();

    expect(store.unread()).toBe(3);
    expect(seen).toEqual([
      [7, true],
      [7, false],
    ]);
    expect(store.version()).toBe(2);
  });

  it("falls back to the count route while the stream is down", async () => {
    const loadUnread = vi.fn(async () => 5);
    const store = createAlertsStore({
      connect: async () => new Response("", { status: 503 }),
      loadUnread,
      retryMs: 10_000,
    });
    store.start();
    await vi.waitFor(() => expect(store.unread()).toBe(5));
    store.stop();
  });
});

describe("popups", () => {
  it("follows the user's level", () => {
    expect(shouldPopUp(item(1, "info"), "all")).toBe(true);
    expect(shouldPopUp(item(1, "info"), "warning")).toBe(false);
    expect(shouldPopUp(item(1, "warning"), "warning")).toBe(true);
    expect(shouldPopUp(item(1, "warning"), "critical")).toBe(false);
    expect(shouldPopUp(item(1, "critical"), "critical")).toBe(true);
    expect(shouldPopUp(item(1, "critical"), "off")).toBe(false);
  });
});

describe("channel config", () => {
  it("reads headers one per line", () => {
    expect(
      parseHeaders("Authorization: Bearer x\nbad line\nX-Id:  7 "),
    ).toEqual({ Authorization: "Bearer x", "X-Id": "7" });
  });

  it("builds only the fields each type uses", () => {
    expect(
      configFrom({
        ...EMPTY,
        type: "webhook",
        url: " https://a.example ",
        headers: "A: b",
        allowPrivateNetwork: true,
      }),
    ).toEqual({
      url: "https://a.example",
      method: "POST",
      headers: { A: "b" },
      allowPrivateNetwork: true,
    });
    expect(
      configFrom({ ...EMPTY, type: "email", to: "ops@example.com" }),
    ).toEqual({ to: "ops@example.com" });
    expect(
      configFrom({
        ...EMPTY,
        type: "discord",
        url: "https://discord.com/api/webhooks/1",
        allowPrivateNetwork: true,
      }),
    ).toEqual({ url: "https://discord.com/api/webhooks/1" });
  });
});
