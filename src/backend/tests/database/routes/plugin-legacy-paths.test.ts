/**
 * contributes.http.legacyPaths: an old URL under "/<plugin id>/" reaches the
 * plugin's router with that prefix removed, and nothing else is caught.
 */

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const routers = vi.hoisted(() => new Map<string, express.Router>());

vi.mock("../../../plugins/http.js", () => ({
  getPluginRouter: (id: string) => routers.get(id),
}));

const { mountPluginLegacyPaths } =
  await import("../../../database/routes/plugin-api-routes.js");

function appWith(active: Array<{ id: string; legacyPaths: string[] }>) {
  const app = express();
  app.get("/core/route", (_req, res) => res.json({ from: "core" }));
  mountPluginLegacyPaths(app, () => active);
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

  it("answers 404 while the plugin serves no router", async () => {
    const app = appWith([{ id: "gone", legacyPaths: ["/gone/hook"] }]);
    const response = await request(app).post("/gone/hook/x");
    expect(response.status).toBe(404);
  });
});
