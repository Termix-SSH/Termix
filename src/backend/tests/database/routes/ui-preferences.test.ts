import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { UI_ONBOARDING_VERSION } from "../../../../types/ui-preferences.js";

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
    expect((await get()).onboarding.completedVersion).toBe(
      UI_ONBOARDING_VERSION,
    );
  });

  it("keeps an old account onboarded after its first write", async () => {
    await put({ overrides: { "plugin:x": { a: 1 } } });
    const stored = JSON.parse(state.row!.data);
    expect(stored.onboarding.completedVersion).toBe(UI_ONBOARDING_VERSION);
    expect((await get()).onboarding.completedVersion).toBe(
      UI_ONBOARDING_VERSION,
    );
  });

  it("repairs a row an earlier write stored as not completed", async () => {
    state.row = {
      data: JSON.stringify({
        onboarding: { completedVersion: 0, completedAt: null, skipped: false },
      }),
    };
    expect((await get()).onboarding.completedVersion).toBe(
      UI_ONBOARDING_VERSION,
    );
  });

  it("still shows onboarding to a new account", async () => {
    state.registeredAt = NEW;
    await put({ preset: "simple" });
    expect((await get()).onboarding.completedVersion).toBe(0);
  });

  it("does not hide a newer onboarding version from someone who finished an older one", async () => {
    state.row = {
      data: JSON.stringify({
        onboarding: {
          completedVersion: UI_ONBOARDING_VERSION - 1,
          completedAt: OLD,
          skipped: false,
        },
      }),
    };
    expect((await get()).onboarding.completedVersion).toBe(
      UI_ONBOARDING_VERSION - 1,
    );
  });
});
