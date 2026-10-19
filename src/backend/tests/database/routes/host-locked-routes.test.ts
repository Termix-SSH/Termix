import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  updates: [] as Array<{ ids: number[]; update: Record<string, unknown> }>,
  renamed: 0,
  folderHosts: [] as Array<{ id: number }>,
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  sshLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  pluginLogger: { warn: vi.fn() },
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { batched: (fn: RequestHandler) => fn },
}));
vi.mock("../../../hosts/defaults/overrides.js", () => ({
  changeHostOverrides: async () => {},
}));
vi.mock("../../../hosts/defaults/recompute.js", () => ({
  recompute: async () => ({ changedHostIds: [] }),
}));
vi.mock("../../../hosts/defaults/service.js", () => ({
  folderCredentialIds: async () => [],
  setFolderCredentialDefault: async () => {},
}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  setHostPluginEnabled: async () => true,
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({
    listBulkUpdateState: async (_userId: string, ids: number[]) =>
      ids.map((id) => ({ id })),
    updateManyForUser: async (
      _userId: string,
      ids: number[],
      update: Record<string, unknown>,
    ) => {
      state.updates.push({ ids, update });
    },
  }),
  createCurrentHostFolderRepository: () => ({
    listHostsInFolder: async () => state.folderHosts,
    renameFolder: async () => {
      state.renamed++;
      return { updatedHosts: 1, updatedCredentials: 0 };
    },
  }),
  createCurrentFolderAccessRepository: () => ({
    renameFolder: async () => {},
  }),
}));

const { registerHostBulkRoutes } =
  await import("../../../database/routes/host-bulk-routes.js");
const { registerHostFolderRoutes } =
  await import("../../../database/routes/host-folder-routes.js");
const { clearHostLocks, provideHostLocks } =
  await import("../../../hosts/locks.js");

const pass: RequestHandler = (req, _res, next) => {
  (req as unknown as { userId: string }).userId = "owner";
  next();
};

function app() {
  const router = express.Router();
  registerHostBulkRoutes(router, pass, pass, pass);
  registerHostFolderRoutes(router, {
    authenticateJWT: pass,
    requireViewPermission: pass,
    requireEditPermission: pass,
    requireDeletePermission: pass,
    requireCredentialEditPermission: pass,
    requireDataAccess: pass,
  });
  const server = express();
  server.use(express.json());
  server.use(router);
  return server;
}

beforeEach(() => {
  state.updates = [];
  state.renamed = 0;
  state.folderHosts = [];
  provideHostLocks("cfg", "Config", {
    isLocked: (hostId) => hostId === 2,
    note: () => null,
    allowManualCreate: () => true,
  });
});
afterEach(() => clearHostLocks());

describe("routes on locked hosts", () => {
  it("still lets a user pin a locked host", async () => {
    await request(app())
      .patch("/bulk-update")
      .send({ hostIds: [1, 2], updates: { pin: true } })
      .expect(200);
    expect(state.updates).toEqual([{ ids: [1, 2], update: { pin: true } }]);
  });

  it("refuses a bulk change that touches a locked host", async () => {
    const res = await request(app())
      .patch("/bulk-update")
      .send({ hostIds: [1, 2], updates: { folder: "Moved" } })
      .expect(403);
    expect(res.body).toMatchObject({ code: "HOST_LOCKED" });
    expect(state.updates).toEqual([]);
  });

  it("refuses renaming a folder that holds a locked host", async () => {
    state.folderHosts = [{ id: 1 }, { id: 2 }];
    await request(app())
      .put("/folders/rename")
      .send({ oldName: "Prod", newName: "Live" })
      .expect(403);
    expect(state.renamed).toBe(0);

    state.folderHosts = [{ id: 1 }];
    await request(app())
      .put("/folders/rename")
      .send({ oldName: "Prod", newName: "Live" })
      .expect(200);
    expect(state.renamed).toBe(1);
  });
});
