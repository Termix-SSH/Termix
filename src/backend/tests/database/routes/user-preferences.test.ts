import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, _res: unknown, next: () => void) => {
          (req as unknown as { userId: string }).userId = "user-1";
          next();
        },
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserPreferenceRepository: () => ({
    findByUserId: async () => state.row,
    upsert: async (_userId: string, updates: Record<string, unknown>) => {
      state.upserts.push(updates);
      state.row = { ...(state.row ?? {}), ...updates };
    },
  }),
}));
vi.mock("../../../database/routes/keybinding-validation.js", () => ({
  isValidKeybinding: () => true,
}));

const { default: routes } =
  await import("../../../database/routes/user-preferences.js");

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  state.row = null;
  state.upserts = [];
  const app = express();
  app.use(express.json());
  app.use("/user-preferences", routes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function put(body: unknown) {
  const res = await fetch(`${baseUrl}/user-preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("user preferences: layout and theme", () => {
  it("reads null for both until chosen", async () => {
    const body = await (await fetch(`${baseUrl}/user-preferences`)).json();
    expect(body).toMatchObject({ layoutId: null, themeId: null });
  });

  it("saves a layout and theme id, and null to follow the default", async () => {
    expect((await put({ layoutId: "fancy", themeId: "nord" })).status).toBe(
      200,
    );
    expect(state.upserts[0]).toMatchObject({
      layoutId: "fancy",
      themeId: "nord",
    });
    const body = await (await fetch(`${baseUrl}/user-preferences`)).json();
    expect(body).toMatchObject({ layoutId: "fancy", themeId: "nord" });

    await put({ layoutId: null });
    expect(state.upserts[1]).toMatchObject({ layoutId: null });
    expect(state.upserts[1]).not.toHaveProperty("themeId");
  });

  it("refuses anything that is not an id", async () => {
    for (const bad of ["Fancy", "../x", "a", 7]) {
      expect((await put({ themeId: bad })).status).toBe(400);
    }
    expect(state.upserts).toHaveLength(0);
  });
});
