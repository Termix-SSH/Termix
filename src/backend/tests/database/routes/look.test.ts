import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  userId: "user-1",
  admins: new Set(["admin-1"]),
  prefs: null as { layoutId: string | null; themeId: string | null } | null,
  settings: new Map<string, string>(),
  audits: [] as unknown[],
  skipped: [] as unknown[],
  defaultLookIds: [] as string[],
  installed: [] as string[],
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: unknown) => {
    state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, _res: unknown, next: () => void) => {
          (req as unknown as { userId: string }).userId = state.userId;
          next();
        },
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserPreferenceRepository: () => ({
    findByUserId: async () => state.prefs,
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({
      id,
      username: id,
      isAdmin: state.admins.has(id),
    }),
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
    delete: async (key: string) => {
      state.settings.delete(key);
    },
  }),
}));
vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      get: (id: string) =>
        id === "shipped-look"
          ? {
              manifest: {
                contributes: {
                  layouts: [
                    { id: "shipped", label: "Shipped", defaultTheme: "ink" },
                  ],
                },
              },
            }
          : undefined,
      list: () => [
        {
          manifest: {
            contributes: {
              layouts: state.installed.map((id) => ({ id, label: id })),
            },
          },
        },
      ],
      skipped: () => state.skipped,
    },
  }),
}));
vi.mock("../../../plugins/bundled-index.js", () => ({
  defaultLookPluginIds: () => state.defaultLookIds,
}));

const { default: lookRoutes } =
  await import("../../../database/routes/look.js");

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  state.userId = "user-1";
  state.prefs = null;
  state.settings.clear();
  state.audits = [];
  state.skipped = [];
  state.defaultLookIds = [];
  state.installed = [];
  delete process.env.TERMIX_SAFE_LAYOUT;

  const app = express();
  app.use(express.json());
  app.use("/user-preferences/look", lookRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env.TERMIX_SAFE_LAYOUT;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getLook() {
  const res = await fetch(`${baseUrl}/user-preferences/look`);
  return { status: res.status, body: await res.json() };
}

async function putDefaults(body: unknown) {
  const res = await fetch(`${baseUrl}/user-preferences/look/defaults`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("GET /user-preferences/look", () => {
  it("is all empty on a fresh install", async () => {
    expect((await getLook()).body).toEqual({
      layoutId: null,
      themeId: null,
      defaults: { layout: null, theme: null },
      defaultLook: { layout: null, theme: null },
      safeLayout: false,
      unavailable: [],
    });
  });

  it("returns the user's pick, the admin defaults and the default look", async () => {
    state.prefs = { layoutId: "mine", themeId: "nord" };
    state.installed = ["mine", "admin-layout"];
    state.settings.set("ui.layout", "admin-layout");
    state.settings.set("ui.theme", "gruvbox");
    state.defaultLookIds = ["shipped-look"];
    state.skipped = [
      {
        id: "broken",
        version: "1.0.0",
        layouts: ["b"],
        themes: [],
        error: "x",
      },
      { id: "other", version: null, layouts: [], themes: [], error: "y" },
    ];
    process.env.TERMIX_SAFE_LAYOUT = "1";

    const { body } = await getLook();
    expect(body).toMatchObject({
      layoutId: "mine",
      themeId: "nord",
      defaults: { layout: "admin-layout", theme: "gruvbox" },
      defaultLook: { layout: "shipped", theme: "ink" },
      safeLayout: true,
    });
    expect(body.unavailable.map((plugin: { id: string }) => plugin.id)).toEqual(
      ["broken"],
    );
  });
});

describe("GET /user-preferences/look with an uninstalled layout", () => {
  it("drops a choice no installed plugin brings, so the next one applies", async () => {
    state.prefs = { layoutId: "deleted", themeId: null };
    state.settings.set("ui.layout", "also-deleted");
    state.installed = ["kept"];
    const { body } = await getLook();
    expect(body.layoutId).toBeNull();
    expect(body.defaults.layout).toBeNull();
  });

  it("keeps a choice whose plugin failed to load, for the repair view", async () => {
    state.prefs = { layoutId: "b", themeId: null };
    state.skipped = [
      {
        id: "broken",
        version: "1.0.0",
        layouts: ["b"],
        themes: [],
        error: "x",
      },
    ];
    expect((await getLook()).body.layoutId).toBe("b");
  });
});

describe("PUT /user-preferences/look/defaults", () => {
  it("is for admins only", async () => {
    const { status } = await putDefaults({ layout: "x" });
    expect(status).toBe(403);
    expect(state.settings.size).toBe(0);
  });

  it("sets and clears the defaults, and audits it", async () => {
    state.userId = "admin-1";
    let res = await putDefaults({ layout: "fancy", theme: "nord" });
    expect(res).toEqual({
      status: 200,
      body: { layout: "fancy", theme: "nord" },
    });
    res = await putDefaults({ layout: null });
    expect(res.body).toEqual({ layout: null, theme: "nord" });
    expect(state.audits).toHaveLength(2);
    expect(state.audits[0]).toMatchObject({ action: "update_default_look" });
  });

  it("refuses something that is not an id", async () => {
    state.userId = "admin-1";
    expect((await putDefaults({ theme: "../evil" })).status).toBe(400);
    expect((await putDefaults({ layout: 5 })).status).toBe(400);
    expect(state.settings.size).toBe(0);
  });
});
