import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  createCorsMiddleware,
  isCorsCredentialedOrigin,
  isCorsOriginAllowed,
  isDesktopAppOrigin,
  isPluginFrameRequest,
} from "../../utils/cors-config.js";

function request(headers: Record<string, string> = {}): Request {
  return {
    headers,
    protocol: "http",
  } as unknown as Request;
}

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.ELECTRON_EMBEDDED;
});

describe("plugin frames (Origin: null)", () => {
  const at = (path: string, headers: Record<string, string> = {}) =>
    ({ headers, protocol: "http", path, url: path }) as unknown as Request;

  it("lets a frame reach plugin routes and assets, without cookies", () => {
    for (const path of ["/plugin-api/docker/x", "/plugin-assets/docker/a.js"]) {
      const req = at(path, { host: "termix.example" });
      expect(isPluginFrameRequest(req, "null"), path).toBe(true);
      expect(isCorsOriginAllowed(req, "null"), path).toBe(true);
      expect(isCorsCredentialedOrigin(req, "null"), path).toBe(false);
    }
  });

  it("keeps an opaque origin away from core routes", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    const req = at("/users/me", { host: "termix.example" });
    expect(isPluginFrameRequest(req, "null")).toBe(false);
    expect(isCorsOriginAllowed(req, "null")).toBe(false);
    expect(isCorsCredentialedOrigin(req, "null")).toBe(false);
  });

  it("lets frames reach the desktop app's embedded backend", () => {
    process.env.ELECTRON_EMBEDDED = "true";
    expect(
      isCorsOriginAllowed(
        at("/plugin-api/docker/x", { host: "127.0.0.1:30001" }),
        "null",
      ),
    ).toBe(true);
    expect(
      isCorsOriginAllowed(
        at("/host/db/host", { host: "127.0.0.1:30001" }),
        "null",
      ),
    ).toBe(false);
  });
});

describe("isCorsOriginAllowed", () => {
  it("allows requests without an Origin header", () => {
    expect(isCorsOriginAllowed(request(), undefined)).toBe(true);
  });

  it("allows the externally forwarded same origin", () => {
    const req = request({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "termix.example",
    });
    expect(isCorsOriginAllowed(req, "https://termix.example")).toBe(true);
  });

  it("allows any origin when no allowlist is configured (self-hosted default)", () => {
    const req = request({ host: "termix.example" });
    expect(isCorsOriginAllowed(req, "https://anything.example")).toBe(true);
  });

  it("allows an explicitly configured origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    expect(isCorsOriginAllowed(request(), "https://portal.example")).toBe(true);
  });

  it("rejects an unlisted origin once an allowlist is configured", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    const req = request({ host: "termix.example" });
    expect(isCorsOriginAllowed(req, "https://attacker.example")).toBe(false);
  });

  describe("embedded desktop backend", () => {
    it("rejects other websites even with no allowlist", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      const req = request({ host: "127.0.0.1:30001" });
      expect(isCorsOriginAllowed(req, "https://evil.example")).toBe(false);
    });

    it("still allows the desktop app and the dev server", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      const req = request({ host: "127.0.0.1:30001" });
      expect(isCorsOriginAllowed(req, "app://termix")).toBe(true);
      expect(isCorsOriginAllowed(req, "http://localhost:5173")).toBe(true);
      expect(isCorsOriginAllowed(req, undefined)).toBe(true);
    });

    it("refuses the old file:// page and look alike schemes", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      const req = request({ host: "127.0.0.1:30001" });
      expect(isCorsOriginAllowed(req, "file://")).toBe(false);
      expect(isCorsOriginAllowed(req, "app://evil")).toBe(false);
      expect(isCorsOriginAllowed(req, "app://termix.evil")).toBe(false);
    });

    it("allows an explicitly configured origin", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
      expect(isCorsOriginAllowed(request(), "https://portal.example")).toBe(
        true,
      );
    });
  });
});

describe("isDesktopAppOrigin", () => {
  it("accepts no origin, the app and the dev server", () => {
    expect(isDesktopAppOrigin(undefined)).toBe(true);
    expect(isDesktopAppOrigin("app://termix")).toBe(true);
    expect(isDesktopAppOrigin("file://")).toBe(false);
    expect(isDesktopAppOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects websites", () => {
    expect(isDesktopAppOrigin("https://evil.example")).toBe(false);
    expect(isDesktopAppOrigin("null")).toBe(false);
  });
});

describe("createCorsMiddleware", () => {
  it("answers 403 to an origin it refuses", () => {
    const before = process.env.ELECTRON_EMBEDDED;
    process.env.ELECTRON_EMBEDDED = "true";
    const middleware = createCorsMiddleware();
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      setHeader() {},
      getHeader() {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;
    middleware(
      Object.assign(
        request({ origin: "https://evil.example", host: "termix.test" }),
        { method: "GET" },
      ),
      res as never,
      () => {
        nextCalled = true;
      },
    );
    if (before === undefined) delete process.env.ELECTRON_EMBEDDED;
    else process.env.ELECTRON_EMBEDDED = before;
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
