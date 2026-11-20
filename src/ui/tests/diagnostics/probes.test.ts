import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/main-axios", () => ({
  getBackendUrl: (path: string) => `http://termix.test${path}`,
}));

vi.mock("@/plugin-host/frames/frame-connection", () => ({
  frameUrl: (id: string) =>
    `http://termix.test/plugin-assets/${id}/_frame/frame.html#`,
}));

vi.mock("@/plugin-host/plugin-store", () => ({
  getPluginStoreState: () => ({
    loaded: true,
    settled: true,
    records: new Map([
      [
        "ai",
        {
          summary: {
            id: "ai",
            enabled: true,
            frontend: true,
            assetVersion: "abc",
            frontendIsolation: "frame",
          },
          frontend: "failed",
        },
      ],
      [
        "off",
        {
          summary: { id: "off", enabled: false, frontend: true },
          frontend: "none",
        },
      ],
    ]),
  }),
}));

const { runProbes } = await import("@/diagnostics/probes");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("runProbes", () => {
  it("spots a login page served to cookie-less requests", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.credentials === "omit" && url.includes("/plugin-assets/")) {
        return new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html", server: "authelia" },
        });
      }
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": url.endsWith(".js?v=abc")
            ? "text/javascript"
            : "application/json",
        },
      });
    }) as unknown as typeof fetch;

    const results = await runProbes();
    const names = results.map((r) => r.name);
    expect(names).toEqual([
      "version",
      "diagnostics request",
      "plugins list",
      "ai bundle",
      "ai frame page",
      "ai bundle from frame",
    ]);
    const fromFrame = results.find((r) => r.name === "ai bundle from frame")!;
    expect(fromFrame).toMatchObject({
      gotHtml: true,
      ok: false,
      cookies: false,
      server: "authelia",
    });
    expect(results.find((r) => r.name === "ai bundle")!.ok).toBe(true);
    expect(results.find((r) => r.name === "ai bundle")!.url).toContain("v=...");
  });

  it("reports a failed request", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const [first] = await runProbes();
    expect(first).toMatchObject({
      ok: false,
      status: null,
      error: "Failed to fetch",
    });
  });
});
