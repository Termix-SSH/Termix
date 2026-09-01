import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createCompressionMiddleware } from "../../utils/compression-config.js";

/** A body big enough to clear the size threshold, and repetitive like real JSON. */
function bigJson(): Record<string, unknown>[] {
  return Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `prod-app-server-${i}`,
    ip: `10.20.0.${i % 254}`,
    folder: "Production / US-East / App Tier",
    enableTerminal: true,
    enableTunnel: true,
  }));
}

describe("createCompressionMiddleware", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  async function startServer(
    configure: (app: express.Express) => void,
  ): Promise<string> {
    const app = express();
    app.use(createCompressionMiddleware());
    configure(app);

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("gzips a large JSON response", async () => {
    const base = await startServer((app) => {
      app.get("/big", (_req, res) => res.json(bigJson()));
    });

    const res = await fetch(`${base}/big`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(res.headers.get("content-encoding")).toBe("gzip");
    // fetch transparently decodes, so the parsed body must still be intact.
    expect(await res.json()).toHaveLength(200);
  });

  it("substantially shrinks the host-list shaped payload", async () => {
    const body = JSON.stringify(bigJson());
    const base = await startServer((app) => {
      app.get("/big", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(body);
      });
    });

    // A gzipped response is sent chunked, so there is no content-length to
    // read; measure the encoded bytes off the socket instead.
    const res = await fetch(`${base}/big`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.headers.get("content-encoding")).toBe("gzip");

    const raw = await new Promise<Buffer>((resolve, reject) => {
      import("http").then(({ get }) => {
        get(
          `${base}/big`,
          { headers: { "Accept-Encoding": "gzip" } },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (c: Buffer) => chunks.push(c));
            response.on("end", () => resolve(Buffer.concat(chunks)));
            response.on("error", reject);
          },
        ).on("error", reject);
      }, reject);
    });

    // Repetitive JSON should compress by well over half.
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.length).toBeLessThan(Buffer.byteLength(body) / 2);
  });

  it("leaves a small response uncompressed", async () => {
    const base = await startServer((app) => {
      app.get("/small", (_req, res) => res.json({ ok: true }));
    });

    const res = await fetch(`${base}/small`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not compress an event stream, which must not be buffered", async () => {
    const base = await startServer((app) => {
      app.get("/stream", (_req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.write(`data: ${"x".repeat(8192)}\n\n`);
        res.end();
      });
    });

    const res = await fetch(`${base}/stream`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    await res.text();

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("does not compress a binary download stream", async () => {
    const base = await startServer((app) => {
      app.get("/download", (_req, res) => {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(Buffer.alloc(16384, 1));
      });
    });

    const res = await fetch(`${base}/download`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    await res.arrayBuffer();

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("honours an explicit opt-out header", async () => {
    const base = await startServer((app) => {
      app.get("/big", (_req, res) => res.json(bigJson()));
    });

    const res = await fetch(`${base}/big`, {
      headers: { "Accept-Encoding": "gzip", "x-no-compression": "1" },
    });
    await res.json();

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("leaves the body alone for a client that cannot accept gzip", async () => {
    const base = await startServer((app) => {
      app.get("/big", (_req, res) => res.json(bigJson()));
    });

    const res = await fetch(`${base}/big`, {
      headers: { "Accept-Encoding": "identity" },
    });

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toHaveLength(200);
  });
});
