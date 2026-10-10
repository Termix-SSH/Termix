import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { LEGACY_SEEN } from "../../../../types/onboarding.js";

const state = vi.hoisted(() => ({
  row: null as { data: string } | null,
  registeredAt: null as string | null,
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
  createCurrentUiPreferenceRepository: () => ({
    findByUserId: async () => state.row,
    upsert: async (_userId: string, data: string) => {
      state.row = { data };
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ registeredAt: state.registeredAt }),
  }),
}));

const { default: uiPreferenceRoutes } =
  await import("../../../database/routes/ui-preferences.js");

let server: http.Server;
let baseUrl: string;

const OLD = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const NEW = new Date().toISOString();

async function put(body: unknown) {
  const res = await fetch(`${baseUrl}/ui-preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get() {
  const res = await fetch(`${baseUrl}/ui-preferences`);
  return (await res.json()).preferences;
}

beforeEach(async () => {
  state.row = null;
  state.registeredAt = OLD;

  const app = express();
  app.use(express.json());
  app.use("/ui-preferences", uiPreferenceRoutes);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ui-preferences onboarding backfill", () => {
  it("treats an old account with no row as onboarded", async () => {
    const onboarding = (await get()).onboarding;
    expect(onboarding.seen).toEqual(LEGACY_SEEN);
    expect(onboarding.baselinePending).toBe(true);
  });

  it("keeps an old account onboarded after its first write", async () => {
    await put({ overrides: { "plugin:x": { a: 1 } } });
    const stored = JSON.parse(state.row!.data);
    expect(stored.onboarding.seen).toEqual(LEGACY_SEEN);
    expect((await get()).onboarding.seen).toEqual(LEGACY_SEEN);
  });

  it("repairs a row an earlier write stored as not completed", async () => {
    state.row = {
      data: JSON.stringify({
        onboarding: { completedVersion: 0, completedAt: null, skipped: false },
      }),
    };
    expect((await get()).onboarding.seen).toEqual(LEGACY_SEEN);
  });

  it("migrates the old completedVersion shape", async () => {
    state.registeredAt = NEW;
    state.row = {
      data: JSON.stringify({
        onboarding: { completedVersion: 2, completedAt: NEW, skipped: false },
      }),
    };
    const onboarding = (await get()).onboarding;
    expect(onboarding.seen).toEqual(LEGACY_SEEN);
    expect(onboarding.baselinePending).toBe(true);
  });

  it("still shows onboarding to a new account", async () => {
    state.registeredAt = NEW;
    await put({ preset: "simple" });
    expect((await get()).onboarding.seen).toEqual({});
  });
});

describe("ui-preferences onboarding seen merge", () => {
  beforeEach(() => {
    state.registeredAt = NEW;
  });

  it("keeps the higher version per step", async () => {
    await put({ onboarding: { seen: { welcome: 2, "rd:guacd": 1 } } });
    await put({ onboarding: { seen: { welcome: 1, appearance: 1 } } });
    expect((await get()).onboarding.seen).toEqual({
      welcome: 2,
      "rd:guacd": 1,
      appearance: 1,
    });
  });

  it("drops invalid seen entries", async () => {
    await put({
      onboarding: { seen: { ok: 1, zero: 0, text: "1", frac: 1.5 } },
    });
    expect((await get()).onboarding.seen).toEqual({ ok: 1 });
  });

  it("does not clear completedAt when a later write omits it", async () => {
    await put({ onboarding: { completedAt: NEW, seen: { done: 1 } } });
    await put({ onboarding: { seen: { "x:y": 1 } } });
    expect((await get()).onboarding.completedAt).toBe(NEW);
  });

  it("clears baselinePending when told to", async () => {
    state.registeredAt = OLD;
    await put({ onboarding: { baselinePending: false, seen: { "x:y": 1 } } });
    const onboarding = (await get()).onboarding;
    expect(onboarding.baselinePending).toBe(false);
    expect(onboarding.seen["x:y"]).toBe(1);
  });
});
