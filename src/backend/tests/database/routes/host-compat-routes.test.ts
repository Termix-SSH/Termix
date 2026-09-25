/**
 * The OPKSSH and Step CA redirect URIs identity providers were registered with before
 * 2.9 must keep reaching the plugin's callback, query intact.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { registerHostAuthCompatRoutes } =
  await import("../../../database/routes/host-compat-routes.js");

let server: http.Server;
let base: string;

beforeEach(async () => {
  const router = express.Router();
  registerHostAuthCompatRoutes(router);
  const app = express();
  app.use("/host", router);
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
