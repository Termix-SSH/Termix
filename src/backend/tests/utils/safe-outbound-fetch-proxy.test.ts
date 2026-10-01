/**
 * An admin-allowlisted private host goes through the configured proxy; a
 * public host never does, since the proxy would skip the address check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; dispatcher: unknown }>,
  proxy: { kind: "proxy" } as unknown,
  proxyConfigured: true,
}));

vi.mock("undici", () => ({
  Agent: class {
    kind = "direct";
    async close() {}
  },
  fetch: async (url: string, init: { dispatcher: unknown }) => {
    h.calls.push({ url, dispatcher: init.dispatcher });
    return new Response("ok");
  },
}));

vi.mock("../../utils/proxy-agent.js", () => ({
  getProxyAgent: () => (h.proxyConfigured ? h.proxy : undefined),
}));

const { safeOutboundFetch } =
  await import("../../utils/safe-outbound-fetch.js");

beforeEach(() => {
  h.calls.length = 0;
  h.proxyConfigured = true;
});

describe("safeOutboundFetch and the proxy", () => {
  it("sends an allowlisted private host through the proxy", async () => {
    await safeOutboundFetch("http://10.0.0.5:11434/api", {}, ["10.0.0.5"]);
    expect(h.calls[0].dispatcher).toBe(h.proxy);
  });

  it("keeps a public host on the checked direct connection", async () => {
    await safeOutboundFetch("https://api.example.com/v1", {}, []);
    expect(h.calls[0].dispatcher).not.toBe(h.proxy);
  });

  it("connects directly when no proxy is configured", async () => {
    h.proxyConfigured = false;
    await safeOutboundFetch("http://10.0.0.5/api", {}, ["10.0.0.5"]);
    expect(h.calls[0].dispatcher).not.toBe(h.proxy);
  });
});
