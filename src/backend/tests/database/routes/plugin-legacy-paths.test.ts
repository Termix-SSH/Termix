/**
 * contributes.http.legacyPaths: an old URL under "/<plugin id>/" reaches the
 * plugin's router with that prefix removed, and nothing else is caught.
 * contributes.http.legacyRedirects: an old URL anywhere redirects to the
 * plugin's own URL, keeping the subpath and the query.
 */

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const routers = vi.hoisted(() => new Map<string, express.Router>());
const installed = vi.hoisted(() => new Set<string>());

vi.mock("../../../plugins/http.js", () => ({
  getPluginRouter: (id: string) => routers.get(id),
  isPluginInstalled: (id: string) => installed.has(id),
}));

const { mountPluginLegacyPaths } =
  await import("../../../database/routes/plugin-api-routes.js");

type Active = Parameters<typeof mountPluginLegacyPaths>[1] extends () => Array<
  infer T
>
  ? T
  : never;

function appWith(
  active: Array<Omit<Active, "legacyRedirects"> & Partial<Active>>,
) {
  const app = express();
  app.get("/core/route", (_req, res) => res.json({ from: "core" }));
  mountPluginLegacyPaths(app, () =>
    active.map((entry) => ({ legacyRedirects: [], ...entry })),
  );
  app.use((_req, res) => res.status(404).json({ from: "fallthrough" }));
  return app;
}

describe("mountPluginLegacyPaths", () => {
  const router = express.Router();
  router.post("/webhook/:token", (req, res) =>
    res.json({ token: req.params.token }),
  );
  routers.set("automations", router);

  it("serves an old URL through the plugin's router", async () => {
    const app = appWith([
      { id: "automations", legacyPaths: ["/automations/webhook"] },
    ]);
    const response = await request(app).post("/automations/webhook/abc123");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: "abc123" });
  });

  it("leaves paths outside the declared prefixes alone", async () => {
    const app = appWith([
      { id: "automations", legacyPaths: ["/automations/webhook"] },
    ]);
    expect((await request(app).get("/automations/other")).body).toEqual({
      from: "fallthrough",
    });
    expect((await request(app).get("/core/route")).body).toEqual({
      from: "core",
    });
  });

  it("answers 404 for a plugin that is not installed", async () => {
    const app = appWith([{ id: "gone", legacyPaths: ["/gone/hook"] }]);
    const response = await request(app).post("/gone/hook/x");
    expect(response.status).toBe(404);
  });

  it("answers 503 for an installed plugin that serves no router", async () => {
    installed.add("paused");
    const app = appWith([{ id: "paused", legacyPaths: ["/paused/hook"] }]);
    const response = await request(app).post("/paused/hook/x");
    expect(response.status).toBe(503);
  });
});

describe("legacy redirects", () => {
  const app = appWith([
    {
      id: "idp",
      legacyPaths: [],
      legacyRedirects: [
        { from: "/host/idp-callback", to: "/callback" },
        { from: "/old-id/u", to: "/u", status: 308 },
      ],
    },
  ]);

  it("redirects to the plugin's URL with the query", async () => {
    const response = await request(app).get(
      "/host/idp-callback?code=abc&state=xyz",
    );
    expect(response.status).toBe(307);
    expect(response.headers.location).toBe(
      "/plugin-api/idp/callback?code=abc&state=xyz",
    );
  });

  it("keeps a subpath and honours a permanent status", async () => {
    const response = await request(app).get("/old-id/u/alice/ca");
    expect(response.status).toBe(308);
    expect(response.headers.location).toBe("/plugin-api/idp/u/alice/ca");
  });

  it("does not catch a path that only shares a prefix", async () => {
    const response = await request(app).get("/host/idp-callbacks");
    expect(response.body).toEqual({ from: "fallthrough" });
  });
});
