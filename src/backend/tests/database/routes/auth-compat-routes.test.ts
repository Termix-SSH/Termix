/**
 * The 2.8 login URLs identity providers and 2.8 clients still call. They
 * forward to whatever replaced them and, with the method's plugin gone, sign
 * nobody in.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { authLogger: log, databaseLogger: log, logger: log };
});
vi.mock("../../../auth/core-auth.js", () => ({
  ensureCoreLoginProviders: () => {},
}));
vi.mock("../../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => false,
}));

const { registerAuthCompatRoutes } =
  await import("../../../database/routes/auth-compat-routes.js");
const { registerLoginMethod, resetAuthRegistryForTests } =
  await import("../../../auth/registry.js");

let server: http.Server;
let base: string;

beforeEach(async () => {
  resetAuthRegistryForTests();
  const router = express.Router();
  router.use(express.json());
  registerAuthCompatRoutes(router);
  const app = express();
  app.use("/users", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(path: string) {
  return fetch(`${base}${path}`, { redirect: "manual" });
}

function registerSso() {
  return registerLoginMethod({
    id: "oidc",
    pluginId: "sso",
    labelKey: "loginWithSso",
    kind: "redirect",
    external: true,
    describe: async () => [
      { id: "3", label: "Keycloak", enabled: true, type: "oidc" },
    ],
    start: async (_request, instanceId) => ({
      redirectUrl: `https://idp.example/auth?provider=${instanceId}`,
    }),
  });
}

describe("the old identity provider URLs", () => {
  it("forwards the callback to the sso plugin, query intact", async () => {
    const response = await get("/users/oidc/callback?code=abc&state=xyz");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "/plugin-api/sso/callback?code=abc&state=xyz",
    );
  });

  it("forwards a form-posted callback with a 308 so the body is resent", async () => {
    const response = await fetch(`${base}/users/oidc/callback`, {
      method: "POST",
      redirect: "manual",
    });
    expect(response.status).toBe(308);
  });

  it("forwards back-channel logout to the sso plugin", async () => {
    const response = await fetch(`${base}/users/oidc/backchannel-logout`, {
      method: "POST",
      redirect: "manual",
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toMatch(
      /\/plugin-api\/sso\/backchannel-logout$/,
    );
  });

  it("forwards the public config to the sso plugin", async () => {
    const response = await get("/users/oidc-config");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(
      /\/plugin-api\/sso\/config$/,
    );
  });
});

describe("the old client routes", () => {
  it("starts an SSO login through the oidc method", async () => {
    registerSso();
    const response = await get("/users/oidc/authorize?providerId=3");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      auth_url: "https://idp.example/auth?provider=3",
    });
  });

  it("lists providers in the 2.8 shape", async () => {
    registerSso();
    const response = await get("/users/sso-providers");
    expect(await response.json()).toEqual([
      { id: 3, name: "Keycloak", type: "oidc", displayOrder: 0 },
    ]);
  });

  it("answers 404 once the plugins are gone", async () => {
    const dispose = registerSso();
    dispose();
    expect((await get("/users/oidc/authorize?providerId=3")).status).toBe(404);
    expect(await (await get("/users/sso-providers")).json()).toEqual([]);
    const ldap = await fetch(`${base}/users/ldap/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: 4, username: "bob", password: "x" }),
    });
    expect(ldap.status).toBe(404);
  });
});
