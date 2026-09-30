import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  isAdmin: true,
  access: { hasAccess: true, isOwner: true },
  saved: [] as unknown[],
  resets: [] as unknown[],
  audits: [] as unknown[],
  folders: new Map<number, { id: number; userId: string; name: string }>(),
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: unknown) => {
    state.audits.push(entry);
  },
  getAuditUsername: async () => "admin",
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => state.access,
      hasPermission: async () => state.isAdmin,
    }),
  },
}));
vi.mock("../../../hosts/usable-credential.js", () => ({
  findUsableCredential: async () => ({}),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostDefaultsRepository: () => ({
    findFolder: async (id: number) => state.folders.get(id) ?? null,
    ensureFolder: async () => 42,
    listHosts: async () => [{ id: 1, userId: "u1" }],
  }),
}));
vi.mock("../../../hosts/defaults/materialize.js", () => ({
  currentCatalog: () => ({ catalog: new Map() }),
  materializeHosts: async () => ({ changedHostIds: [1, 2] }),
}));
vi.mock("../../../hosts/defaults/recompute.js", () => ({
  getRecomputeJob: (id: string) =>
    id === "job-1" ? { id, status: "done", changedHosts: 3 } : undefined,
  recompute: async () => ({ changedHostIds: [5] }),
  startRecomputeJob: () => ({ id: "job-1" }),
  targetForScope: () => ({ all: true }),
}));
vi.mock("../../../hosts/defaults/service.js", () => ({
  levelsAbove: async () => ({ admin: new Map(), user: new Map(), folders: [] }),
  readLevel: async () => ({ "core.sshPort": 2022 }),
  resolveAll: () => ({}),
  resolveForEditor: async () => ({
    "core.sshPort": { value: 2022, source: { level: "user" } },
  }),
  saveLevel: async (scope: unknown, change: unknown) => {
    state.saved.push({ scope, change });
  },
  validateLevelChange: async (
    _scope: unknown,
    input: { set?: Record<string, unknown> },
  ) =>
    input.set && "bad.key" in input.set
      ? { set: new Map(), unset: new Set(), errors: { "bad.key": "no" } }
      : {
          set: new Map(Object.entries(input.set ?? {})),
          unset: new Set(),
          errors: {},
        },
}));
vi.mock("../../../hosts/defaults/overrides.js", () => ({
  changeHostOverrides: async (hostIds: number[], change: unknown) => {
    state.resets.push({ hostIds, change });
  },
}));
vi.mock("../../../database/routes/host-bulk-routes.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../database/routes/host-bulk-routes.js")
  >("../../../database/routes/host-bulk-routes.js");
  return { readDefaultsReset: actual.readDefaultsReset };
});

const { registerHostDefaultsRoutes } =
  await import("../../../database/routes/host-defaults-routes.js");

const pass: RequestHandler = (_req, _res, next) => next();
const adminOnly: RequestHandler = (_req, res, next) =>
  state.isAdmin ? next() : void res.status(403).json({ error: "no" });

function app() {
  const router = express.Router();
  router.use((req, _res, next) => {
    (req as unknown as { userId: string }).userId = "u1";
    next();
  });
  registerHostDefaultsRoutes(router, {
    authenticateJWT: pass,
    requireEditPermission: pass,
    requireDataAccess: pass,
    requireAdminSettings: adminOnly,
  });
  const server = express();
  server.use(express.json());
  server.use("/host", router);
  return server;
}

beforeEach(() => {
  state.isAdmin = true;
  state.access = { hasAccess: true, isOwner: true };
  state.saved = [];
  state.resets = [];
  state.audits = [];
  state.folders = new Map([
    [1, { id: 1, userId: "u1", name: "Prod" }],
    [2, { id: 2, userId: "u2", name: "Theirs" }],
  ]);
});

describe("host defaults routes", () => {
  it("keeps the server level to admins", async () => {
    state.isAdmin = false;
    expect((await request(app()).get("/host/defaults/admin")).status).toBe(403);
    expect(
      (await request(app()).put("/host/defaults/admin").send({ set: {} }))
        .status,
    ).toBe(403);
  });

  it("saves the server level as a background job, audited", async () => {
    const response = await request(app())
      .put("/host/defaults/admin")
      .send({ set: { "core.sshPort": 2022 } });
    expect(response.body).toEqual({ jobId: "job-1" });
    expect(state.audits).toHaveLength(1);
    const job = await request(app()).get("/host/defaults/jobs/job-1");
    expect(job.body.changedHosts).toBe(3);
  });

  it("saves a user's own level and says how many hosts changed", async () => {
    const response = await request(app())
      .put("/host/defaults/user")
      .send({ set: { "core.sshPort": 2022 } });
    expect(response.body).toEqual({ changedHosts: 1 });
    expect(state.saved[0]).toMatchObject({
      scope: { level: "user", userId: "u1" },
    });
  });

  it("reports rejected values", async () => {
    const response = await request(app())
      .put("/host/defaults/user")
      .send({ set: { "bad.key": 1 } });
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual({ "bad.key": "no" });
  });

  it("only opens a folder the user owns", async () => {
    expect((await request(app()).get("/host/defaults/folders/1")).status).toBe(
      200,
    );
    expect((await request(app()).get("/host/defaults/folders/2")).status).toBe(
      404,
    );
    const created = await request(app())
      .post("/host/defaults/folders")
      .send({ name: "New" });
    expect(created.body).toEqual({ id: 42 });
  });

  it("previews a change without saving it", async () => {
    const response = await request(app())
      .post("/host/defaults/preview")
      .send({ level: "user", set: { "core.sshPort": 1 } });
    expect(response.body).toEqual({ changedHosts: 2 });
    expect(state.saved).toEqual([]);
  });

  it("resolves a host's defaults for the editor", async () => {
    const response = await request(app()).get(
      "/host/defaults/resolve?hostId=1",
    );
    expect(response.body.values["core.sshPort"].value).toBe(2022);
  });

  it("resets a host, but never a shared editor over the owner's login", async () => {
    await request(app())
      .post("/host/db/host/7/reset-defaults")
      .send({ keys: ["core.sshPort"] });
    expect(state.resets).toHaveLength(1);

    state.access = { hasAccess: true, isOwner: false };
    const all = await request(app())
      .post("/host/db/host/7/reset-defaults")
      .send({ all: true });
    expect(all.status).toBe(403);
    expect(
      (await request(app()).post("/host/db/host/7/reset-defaults").send({}))
        .status,
    ).toBe(400);
  });
});
