import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const settings = vi.hoisted(() => new Map<string, string>());
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      settings.set(key, value);
    },
  }),
}));
vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn() },
}));
import { registerHostTagRoutes } from "../../../database/routes/host-tag-routes.js";

function app() {
  const server = express();
  server.use(express.json());
  registerHostTagRoutes(
    server,
    (req, res, next) =>
      req.headers.authorization ? next() : void res.sendStatus(401),
    (req, res, next) =>
      req.headers.authorization === "admin" ? next() : void res.sendStatus(403),
  );
  return server;
}

beforeEach(() => settings.clear());
describe("instance host tag catalog", () => {
  it("allows authenticated users to read the same admin-managed catalog", async () => {
    const server = app();
    await request(server)
      .put("/tags")
      .set("Authorization", "admin")
      .send({ tags: [" Linux ", "Domain Controller", "Linux"] })
      .expect(200, { tags: ["Linux", "Domain Controller"] });
    await request(server)
      .get("/tags")
      .set("Authorization", "member")
      .expect(200, { tags: ["Linux", "Domain Controller"] });
  });
  it("rejects anonymous reads and non-admin writes", async () => {
    await request(app()).get("/tags").expect(401);
    await request(app())
      .put("/tags")
      .set("Authorization", "member")
      .send({ tags: ["test"] })
      .expect(403);
    expect(settings.size).toBe(0);
  });
  it.each([null, [42], [" "], ["x".repeat(101)], Array(501).fill("tag")])(
    "rejects invalid catalogs",
    async (tags) => {
      await request(app())
        .put("/tags")
        .set("Authorization", "admin")
        .send({ tags })
        .expect(400);
      expect(settings.size).toBe(0);
    },
  );
  it("allows clearing suggestions without modifying hosts", async () => {
    settings.set("host_tag_catalog", '["Linux"]');
    await request(app())
      .put("/tags")
      .set("Authorization", "admin")
      .send({ tags: [] })
      .expect(200, { tags: [] });
  });

  it("reads a damaged catalog as empty instead of failing", async () => {
    settings.set("host_tag_catalog", "{not json");
    await request(app())
      .get("/tags")
      .set("Authorization", "member")
      .expect(200, { tags: [] });
  });
});
