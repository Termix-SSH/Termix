import { afterEach, describe, expect, it } from "vitest";
import {
  getClientIp,
  getRequestBasePath,
  getRequestBaseUrl,
  getRequestBaseUrlWithForceHTTPS,
  getRequestOrigin,
  normalizeBasePath,
} from "../../utils/request-origin.js";

function request(headers: Record<string, string | string[] | undefined>) {
  return {
    headers,
    socket: {},
  } as Parameters<typeof getRequestBasePath>[0];
}

function requestWithSocket(
  headers: Record<string, string | string[] | undefined>,
  socket: { remoteAddress?: string },
  ip?: string,
) {
  return {
    headers,
    socket,
    ip,
  } as unknown as Parameters<typeof getClientIp>[0];
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("normalizeBasePath", () => {
  it("normalizes empty and root paths", () => {
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath(" / ")).toBe("");
  });

  it("normalizes configured base paths", () => {
    expect(normalizeBasePath("termix")).toBe("/termix");
    expect(normalizeBasePath("/termix/")).toBe("/termix");
    expect(normalizeBasePath("/termix, /other")).toBe("/termix");
  });

  it("accepts forwarded prefix values that include a URL", () => {
    expect(normalizeBasePath("https://example.com/termix/")).toBe("/termix");
  });
});

describe("getRequestBasePath", () => {
  const previousBasePath = process.env.BASE_PATH;
  const previousViteBasePath = process.env.VITE_BASE_PATH;
  const previousForceHttps = process.env.OIDC_FORCE_HTTPS;

  afterEach(() => {
    restoreEnv("BASE_PATH", previousBasePath);
    restoreEnv("VITE_BASE_PATH", previousViteBasePath);
    restoreEnv("OIDC_FORCE_HTTPS", previousForceHttps);
  });

  it("uses BASE_PATH before forwarded headers", () => {
    process.env.BASE_PATH = "/admin/";
    process.env.VITE_BASE_PATH = "";

    expect(
      getRequestBasePath(request({ "x-forwarded-prefix": "/termix" })),
    ).toBe("/admin");
  });

  it("falls back to VITE_BASE_PATH for deployments that already set it", () => {
    process.env.BASE_PATH = "";
    process.env.VITE_BASE_PATH = "/termix/";

    expect(getRequestBasePath(request({}))).toBe("/termix");
  });

  it("uses X-Forwarded-Prefix when no env base path is set", () => {
    process.env.BASE_PATH = "";
    process.env.VITE_BASE_PATH = "";

    expect(
      getRequestBasePath(request({ "x-forwarded-prefix": "/termix/" })),
    ).toBe("/termix");
  });

  it("builds a public base URL with forwarded origin and prefix", () => {
    process.env.BASE_PATH = "";
    process.env.VITE_BASE_PATH = "";

    expect(
      getRequestBaseUrl(
        request({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "example.com",
          "x-forwarded-prefix": "/termix",
        }),
      ),
    ).toBe("https://example.com/termix");
  });

  it("applies OIDC_FORCE_HTTPS to public base URLs", () => {
    process.env.BASE_PATH = "";
    process.env.VITE_BASE_PATH = "";
    process.env.OIDC_FORCE_HTTPS = "true";

    expect(
      getRequestBaseUrlWithForceHTTPS(
        request({
          "x-forwarded-proto": "http",
          "x-forwarded-host": "example.com",
          "x-forwarded-prefix": "/termix",
        }),
      ),
    ).toBe("https://example.com/termix");
  });
});

describe("getClientIp", () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXIES;

  afterEach(() => {
    restoreEnv("TRUSTED_PROXIES", originalTrustedProxies);
  });

  it("stops at the rightmost hop that is not a trusted proxy", () => {
    // Only loopback is trusted by default, so the two private hops the client
    // claims are as untrustworthy as the public entry it put in front of them.
    expect(
      getClientIp(
        requestWithSocket(
          { "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" },
          { remoteAddress: "::ffff:127.0.0.1" },
        ),
      ),
    ).toBe("10.0.0.2");
  });

  it("walks past hops the deployment declares trusted", () => {
    process.env.TRUSTED_PROXIES = "loopback,uniquelocal";
    expect(
      getClientIp(
        requestWithSocket(
          { "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" },
          { remoteAddress: "::ffff:127.0.0.1" },
        ),
      ),
    ).toBe("203.0.113.7");
  });

  it("ignores a forwarded header from an untrusted peer", () => {
    // A client reaching the backend directly cannot promote itself by
    // claiming to be a proxy for someone else.
    expect(
      getClientIp(
        requestWithSocket(
          { "x-forwarded-for": "203.0.113.7" },
          { remoteAddress: "198.51.100.9" },
        ),
      ),
    ).toBe("198.51.100.9");
  });

  it("handles X-Forwarded-For sent as a header array", () => {
    process.env.TRUSTED_PROXIES = "loopback,uniquelocal";
    expect(
      getClientIp(
        requestWithSocket(
          { "x-forwarded-for": ["203.0.113.7", "10.0.0.1"] },
          { remoteAddress: "::ffff:127.0.0.1" },
        ),
      ),
    ).toBe("203.0.113.7");
  });

  it("prefers req.ip, which Express derived from the same trust setting", () => {
    expect(
      getClientIp(
        requestWithSocket(
          {},
          { remoteAddress: "::ffff:127.0.0.1" },
          "198.51.100.5",
        ),
      ),
    ).toBe("198.51.100.5");
  });

  it("falls back to the peer when a trusted proxy forwards no chain", () => {
    expect(
      getClientIp(requestWithSocket({}, { remoteAddress: "::ffff:127.0.0.1" })),
    ).toBe("127.0.0.1");
  });

  it("falls back to the raw socket peer when nothing else is available", () => {
    expect(
      getClientIp(requestWithSocket({}, { remoteAddress: "198.51.100.9" })),
    ).toBe("198.51.100.9");
  });

  it("returns unknown when no IP information exists at all", () => {
    expect(getClientIp(requestWithSocket({}, {}))).toBe("unknown");
  });
});

describe("getRequestOrigin", () => {
  it("ignores non-numeric forwarded ports", () => {
    expect(
      getRequestOrigin(
        request({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "termix.test.de",
          "x-forwarded-port": "{server_port}",
        }),
      ),
    ).toBe("https://termix.test.de");
  });

  it("drops invalid ports embedded in forwarded hosts", () => {
    expect(
      getRequestOrigin(
        request({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "termix.test.de:{server_port}",
        }),
      ),
    ).toBe("https://termix.test.de");
  });

  it("keeps valid non-default forwarded ports", () => {
    expect(
      getRequestOrigin(
        request({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "termix.test.de",
          "x-forwarded-port": "8443",
        }),
      ),
    ).toBe("https://termix.test.de:8443");
  });

  it("omits default forwarded ports", () => {
    expect(
      getRequestOrigin(
        request({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "termix.test.de",
          "x-forwarded-port": "443",
        }),
      ),
    ).toBe("https://termix.test.de");
  });
});
