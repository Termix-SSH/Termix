import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

type Row = { pluginId: string; client: string; data: string };

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  saves: 0,
  apiKey: false,
  installed: new Set(["notes", "docker"]),
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, _res: unknown, next: () => void) => {
          Object.assign(req, {
            userId: "user-1",
            sessionId: "s1",
            apiKeyId: state.apiKey ? "k1" : undefined,
          });
          next();
        },
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentFrameRegistrationRepository: () => ({
    findForClient: async (_userId: string, client: string) =>
      state.rows.filter((row) => row.client === client),
    saveMany: async (
      _userId: string,
      client: string,
      entries: Array<{ pluginId: string; data: string }>,
    ) => {
      state.saves++;
      for (const entry of entries) {
        state.rows = state.rows.filter(
          (row) => !(row.client === client && row.pluginId === entry.pluginId),
        );
        state.rows.push({ client, ...entry });
      }
    },
  }),
}));
vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: { get: (id: string) => (state.installed.has(id) ? {} : null) },
  }),
}));

const { default: routes } =
  await import("../../../database/routes/frame-registrations.js");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/plugins/frame-registrations", routes);

const entry = {
  version: "abc:123",
  live: [],
  registrations: [{ rid: "panel#1", kind: "panel", raw: { id: "p" } }],
};

beforeEach(() => {
  state.rows = [];
  state.saves = 0;
  state.apiKey = false;
  state.installed = new Set(["notes", "docker"]);
});

describe("frame registrations", () => {
  it("saves installed plugins per client and reads them back", async () => {
    const put = await request(app)
      .put("/plugins/frame-registrations")
      .send({ client: "web", entries: { notes: entry, gone: entry } })
      .expect(200);
    expect(put.body.saved).toBe(1);
    const web = await request(app)
      .get("/plugins/frame-registrations?client=web")
      .expect(200);
    expect(web.body.entries).toEqual({ notes: entry });
    const desktop = await request(app)
      .get("/plugins/frame-registrations?client=desktop")
      .expect(200);
    expect(desktop.body.entries).toEqual({});
  });

  it("keeps only registrations, never answers or values", async () => {
    await request(app)
      .put("/plugins/frame-registrations")
      .send({
        client: "web",
        entries: { notes: { ...entry, answers: { a: 1 }, values: { b: 2 } } },
      })
      .expect(200);
    expect(JSON.parse(state.rows[0].data)).toEqual(entry);
  });

  it("hides plugins removed since they were saved", async () => {
    await request(app)
      .put("/plugins/frame-registrations")
      .send({ client: "web", entries: { notes: entry } })
      .expect(200);
    state.installed.delete("notes");
    const res = await request(app)
      .get("/plugins/frame-registrations?client=web")
      .expect(200);
    expect(res.body.entries).toEqual({});
  });

  it("skips bad and oversized entries", async () => {
    const big = {
      ...entry,
      registrations: [{ rid: "a#1", kind: "panel", raw: "x".repeat(70_000) }],
    };
    const res = await request(app)
      .put("/plugins/frame-registrations")
      .send({
        client: "web",
        entries: { notes: { version: 1 }, docker: big },
      })
      .expect(200);
    expect(res.body.saved).toBe(0);
    expect(state.rows).toEqual([]);
  });

  it("refuses an unknown client and a bad body", async () => {
    await request(app)
      .get("/plugins/frame-registrations?client=phone")
      .expect(400);
    await request(app)
      .put("/plugins/frame-registrations")
      .send({ client: "web", entries: [] })
      .expect(400);
  });

  it("refuses API keys", async () => {
    state.apiKey = true;
    await request(app)
      .get("/plugins/frame-registrations?client=web")
      .expect(401);
    await request(app)
      .put("/plugins/frame-registrations")
      .send({ client: "web", entries: {} })
      .expect(401);
  });
});
