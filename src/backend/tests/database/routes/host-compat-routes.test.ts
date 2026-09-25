/**
 * The OPKSSH, Step CA and Vault redirect URIs identity providers were registered with before
 * 2.9 must keep reaching the plugin's callback, query intact, and the Termix
 * ID resolver URLs servers fetch must keep reaching the plugin's resolver.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { registerHostAuthCompatRoutes, registerTermixIdCompatRoutes } =
  await import("../../../database/routes/host-compat-routes.js");

let server: http.Server;
let base: string;

beforeEach(async () => {
  const router = express.Router();
  registerHostAuthCompatRoutes(router);
  const app = express();
  app.use("/host", router);
  const termixId = express.Router();
  registerTermixIdCompatRoutes(termixId);
  app.use("/termix-id", termixId);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the old OPKSSH callback", () => {
  it("forwards to the plugin's callback with the query", async () => {
    const response = await fetch(
      `${base}/host/opkssh-callback?code=abc&state=xyz`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/plugin-api/opkssh/callback?code=abc&state=xyz",
    );
  });

  it("keeps a subpath", async () => {
    const response = await fetch(`${base}/host/opkssh-callback/req-1/done`, {
      redirect: "manual",
    });
    expect(response.headers.get("location")).toBe(
      "/plugin-api/opkssh/callback/req-1/done",
    );
  });
});

describe("the old Step CA callback", () => {
  it("forwards to the plugin's callback with the query", async () => {
    const response = await fetch(
      `${base}/host/step-ca-callback?code=abc&state=xyz`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/plugin-api/step-ca/callback?code=abc&state=xyz",
    );
  });
});

describe("the old Vault callback", () => {
  it("forwards to the plugin's callback with the query", async () => {
    const { registerVaultCompatRoutes } =
      await import("../../../database/routes/host-compat-routes.js");
    const router = express.Router();
    registerVaultCompatRoutes(router);
    const app = express();
    app.use("/vault", router);
    const vaultServer = http.createServer(app);
    await new Promise<void>((resolve) => vaultServer.listen(0, resolve));
    const port = (vaultServer.address() as AddressInfo).port;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/vault/oidc/callback?code=abc&state=xyz`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "/plugin-api/vault/oidc/callback?code=abc&state=xyz",
      );
    } finally {
      await new Promise<void>((resolve) => vaultServer.close(() => resolve()));
    }
  });
});

describe("the old Termix ID resolver URLs", () => {
  it.each([
    ["/termix-id/u/alice", "/plugin-api/termix-identity/u/alice"],
    [
      "/termix-id/u/alice/ED25519",
      "/plugin-api/termix-identity/u/alice/ED25519",
    ],
    ["/termix-id/u/alice/ca", "/plugin-api/termix-identity/u/alice/ca"],
  ])("permanently redirects %s", async (path, target) => {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(target);
  });

  it("does not forward the old management routes", async () => {
    const response = await fetch(`${base}/termix-id/me`, {
      redirect: "manual",
    });
    expect(response.status).toBe(404);
  });
});
