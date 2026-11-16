/**
 * The desktop keeps every response's frame headers, except Termix server
 * pages the app shell itself frames. Plugin frame pages keep their CSP.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  shouldRelax,
  relaxFrameHeaders,
} = require("../../../../electron/frame-headers.cjs");

const shellHeaders = {
  "content-security-policy": [
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
  ],
  "x-frame-options": ["DENY"],
};
const top = { top: { url: "app://termix/index.html" } };
const local = "http://127.0.0.1:30001";

function details(url: string, extra: Record<string, unknown> = {}) {
  return {
    url,
    resourceType: "subFrame",
    frame: top,
    responseHeaders: {},
    ...extra,
  };
}

describe("desktop frame headers", () => {
  it("never touches a plugin frame page", () => {
    expect(
      shouldRelax(details(`${local}/plugin-assets/docker/_frame/`), {
        serverOrigins: [local],
      }),
    ).toBe(false);
    expect(
      shouldRelax(
        details("https://server.example/plugin-assets/x/_frame/view", {
          responseHeaders: shellHeaders,
        }),
      ),
    ).toBe(false);
  });

  it("relaxes the local backend and linked server inside the app shell", () => {
    expect(shouldRelax(details(`${local}/`), { serverOrigins: [local] })).toBe(
      true,
    );
  });

  it("relaxes a Termix login page being linked, by its shell headers", () => {
    expect(
      shouldRelax(
        details("https://other.example/", { responseHeaders: shellHeaders }),
      ),
    ).toBe(true);
  });

  it("leaves other sites, top level pages and other windows alone", () => {
    expect(
      shouldRelax(
        details("https://news.example/", {
          responseHeaders: { "x-frame-options": ["SAMEORIGIN"] },
        }),
        { serverOrigins: [local] },
      ),
    ).toBe(false);
    expect(
      shouldRelax(details(`${local}/`, { resourceType: "mainFrame" }), {
        serverOrigins: [local],
      }),
    ).toBe(false);
    expect(
      shouldRelax(
        details(`${local}/`, {
          frame: { top: { url: "https://evil.example" } },
        }),
        { serverOrigins: [local] },
      ),
    ).toBe(false);
  });

  it("allows the dev server as the shell only in dev", () => {
    const dev = details(`${local}/`, {
      frame: { top: { url: "http://localhost:5173/" } },
    });
    expect(shouldRelax(dev, { serverOrigins: [local] })).toBe(false);
    expect(shouldRelax(dev, { serverOrigins: [local], dev: true })).toBe(true);
  });

  it("drops only frame-ancestors and X-Frame-Options", () => {
    const headers = {
      "Content-Security-Policy": [
        "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
        "frame-ancestors 'self'",
      ],
      "X-Frame-Options": ["DENY"],
      "Set-Cookie": ["a=b"],
    };
    relaxFrameHeaders(headers);
    expect(headers).toEqual({
      "Content-Security-Policy": ["default-src 'self'; object-src 'none'"],
      "Set-Cookie": ["a=b"],
    });
  });
});
