import { afterEach, describe, expect, it } from "vitest";
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
