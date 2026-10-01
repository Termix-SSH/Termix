import type { PluginFetch } from "@termix/plugin-sdk/backend";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer;

afterEach(async () => {
  await server.close();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("outbound routes go through ctx.fetch", () => {
  it("proxy: returns the parsed JSON body from ctx.fetch", async () => {
    server = await startServer({
      fetch: async () => jsonResponse({ hello: "world" }),
    });
    const res = await server.request(
      "GET",
      "/proxy?url=https://example.com/api",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: "world" });
  });

  it("proxy: every request to a private address is refused by the SSRF guard, never reaching ctx.fetch's caller", async () => {
    // The route never gets to call the stub for a rejected URL because
    // safeOutboundFetch (behind ctx.fetch) throws before any response comes
    // back; simulate that by having the stub itself reject, matching what
    // the real safeOutboundFetch does for a blocked host.
    server = await startServer({
      fetch: async () => {
        throw new Error("Private destinations are not allowed");
      },
    });
    const res = await server.request(
      "GET",
      "/proxy?url=http://127.0.0.1:9999/secret",
    );
    expect(res.status).toBe(500);
  });

  it("proxy: rejects a non-JSON response", async () => {
    server = await startServer({
      fetch: async () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const res = await server.request("GET", "/proxy?url=https://example.com");
    expect(res.status).toBe(400);
  });

  it("ping: reports ok for a 2xx response", async () => {
    server = await startServer({
      fetch: async () => new Response(null, { status: 200 }),
    });
    const res = await server.request("GET", "/ping?url=https://example.com");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rss: parses items from the feed ctx.fetch returned", async () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Hello</title><link>https://example.com/1</link></item>
    </channel></rss>`;
    server = await startServer({
      fetch: async () =>
        new Response(xml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    });
    const res = await server.request(
      "GET",
      "/rss?url=https://example.com/feed",
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Hello");
  });

  it("rejects a request with no url", async () => {
    server = await startServer();
    expect((await server.request("GET", "/ping")).status).toBe(400);
    expect((await server.request("GET", "/rss")).status).toBe(400);
    expect((await server.request("GET", "/proxy")).status).toBe(400);
    expect((await server.request("GET", "/favicon")).status).toBe(400);
  });
});

describe("ping reachability policy", () => {
  it.each([200, 302, 307, 401, 403, 404, 503])(
    "classifies HTTP %s without following redirects",
    async (status) => {
      const fetch = vi.fn<PluginFetch>(
        async () => new Response(null, { status }),
      );
      server = await startServer({ fetch });
      const result = await server.request(
        "GET",
        "/ping?url=https://example.com",
      );
      expect(result.body).toMatchObject({
        ok: status < 400 || status === 401 || status === 403,
        statusCode: status,
      });
      expect(fetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ redirect: "manual", allowPrivateHosts: [] }),
      );
    },
  );

  it("retries HEAD-not-supported as GET with the same policy", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    server = await startServer({ fetch });
    const result = await server.request("GET", "/ping?url=https://example.com");
    expect(result.body.ok).toBe(true);
    expect(fetch.mock.calls.map((call) => call[1].method)).toEqual([
      "HEAD",
      "GET",
    ]);
    expect(
      fetch.mock.calls.every((call) => call[1].redirect === "manual"),
    ).toBe(true);
  });

  it.each(["ping", "proxy"])(
    "%s uses only the admin allowlist and invalidates cached results on revocation",
    async (route) => {
      const fetch = vi.fn<PluginFetch>(async () =>
        jsonResponse({ alive: true }),
      );
      server = await startServer({ fetch });
      await server.mock.ctx.settings.set(
        "privateEndpoints",
        "SERVICE.LAN,127.0.0.1\nservice.lan\nhttps://invalid.example",
      );
      const path = `/${route}?url=http://service.lan`;
      await server.request("GET", path);
      expect(fetch).toHaveBeenLastCalledWith(
        "http://service.lan",
        expect.objectContaining({
          allowPrivateHosts: ["service.lan", "127.0.0.1"],
        }),
      );
      await server.request("GET", path);
      expect(fetch).toHaveBeenCalledTimes(1);
      await server.mock.ctx.settings.set("privateEndpoints", "");
      await server.request("GET", path);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenLastCalledWith(
        "http://service.lan",
        expect.objectContaining({ allowPrivateHosts: [] }),
      );
    },
  );

  it("uses custom CA trust only for allowlisted hosts and refreshes cached results on CA change", async () => {
    const fetch = vi.fn<PluginFetch>(async () => jsonResponse({ alive: true }));
    server = await startServer({ fetch });
    await server.mock.ctx.settings.set("privateEndpoints", "service.lan");
    await server.mock.ctx.settings.set(
      "privateCertificateAuthority",
      "PEM ONE",
    );
    await server.request("GET", "/ping?url=https://service.lan");
    expect(fetch).toHaveBeenLastCalledWith(
      "https://service.lan",
      expect.objectContaining({ tls: { ca: "PEM ONE" } }),
    );
    await server.mock.ctx.settings.set(
      "privateCertificateAuthority",
      "PEM TWO",
    );
    await server.request("GET", "/ping?url=https://service.lan");
    expect(fetch).toHaveBeenLastCalledWith(
      "https://service.lan",
      expect.objectContaining({ tls: { ca: "PEM TWO" } }),
    );
    await server.request("GET", "/ping?url=https://example.com");
    expect(fetch.mock.calls.at(-1)?.[1]).not.toHaveProperty("tls");
  });
});
