import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  tlsEnabled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    getBoolean: async (key: string, fallback: boolean) =>
      h.settings.has(key) ? h.settings.get(key) === "true" : fallback,
    set: async (key: string, value: string) => {
      h.settings.set(key, value);
    },
  }),
}));
vi.mock("../../tls/tls-service.js", () => ({
  getTlsConfig: () => ({ enabled: h.tlsEnabled, port: 8443 }),
}));

const { httpsPolicyMiddleware, setForceHttps, resetHttpsPolicyForTests } =
  await import("../../tls/https-policy.js");

function run(
  path: string,
  { secure = false, headers = {} as Record<string, string> } = {},
) {
  const all: Record<string, string> = { host: "termix.lan:8080", ...headers };
  const req = {
    secure,
    path,
    originalUrl: path,
    url: path,
    get: (name: string) => all[name.toLowerCase()],
  };
  const res = {
    headers: {} as Record<string, string>,
    redirected: null as null | { status: number; url: string },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    redirect(status: number, url: string) {
      res.redirected = { status, url };
    },
  };
  const next = vi.fn();
  return httpsPolicyMiddleware(req as never, res as never, next).then(() => ({
    res,
    next,
  }));
}

beforeEach(() => {
  h.settings.clear();
  h.tlsEnabled = true;
  resetHttpsPolicyForTests();
});

describe("https policy", () => {
  it("is off by default", async () => {
    const { res, next } = await run("/users/me");
    expect(next).toHaveBeenCalled();
    expect(res.redirected).toBeNull();
    expect(res.headers).toEqual({});
  });

  it("does nothing while HTTPS is off, even when turned on", async () => {
    await setForceHttps(true);
    h.tlsEnabled = false;
    const { res, next } = await run("/users/me");
    expect(next).toHaveBeenCalled();
    expect(res.redirected).toBeNull();
  });

  it("redirects plain HTTP to the HTTPS port", async () => {
    await setForceHttps(true);
    const { res, next } = await run("/users/me?x=1");
    expect(next).not.toHaveBeenCalled();
    expect(res.redirected).toEqual({
      status: 308,
      url: "https://termix.lan:8443/users/me?x=1",
    });
  });

  it("trusts X-Forwarded-Proto and sends HSTS over HTTPS", async () => {
    await setForceHttps(true);
    const forwarded = await run("/users/me", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(forwarded.next).toHaveBeenCalled();
    expect(forwarded.res.headers["Strict-Transport-Security"]).toBe(
      "max-age=31536000",
    );

    const direct = await run("/users/me", { secure: true });
    expect(direct.next).toHaveBeenCalled();
    expect(direct.res.headers["Strict-Transport-Security"]).toBeDefined();
  });

  it("leaves certificate checks and health probes on HTTP", async () => {
    await setForceHttps(true);
    for (const path of ["/.well-known/acme-challenge/abc", "/health"]) {
      const { res, next } = await run(path);
      expect(next).toHaveBeenCalled();
      expect(res.redirected).toBeNull();
    }
  });
});
