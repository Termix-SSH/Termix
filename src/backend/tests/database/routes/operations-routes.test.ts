import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "user-1",
  apiKeyId: undefined as string | undefined,
  apiKeyScopes: undefined as string[] | null | undefined,
  actingAdminUserId: undefined as string | undefined,
  viewAll: false,
  hostAccess: false,
  runs: new Map<string, Record<string, unknown>>(),
  runOperation: vi.fn(),
  decide: vi.fn(),
  cancel: vi.fn(async () => true),
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  pluginLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: Record<string, unknown>,
          _res: unknown,
          next: () => void,
        ): void => {
          req.userId = state.userId;
          req.apiKeyId = state.apiKeyId;
          req.apiKeyScopes = state.apiKeyScopes;
          req.actingAdminUserId = state.actingAdminUserId;
          next();
        },
    }),
  },
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async () => state.viewAll,
      canAccessHost: async () => ({ hasAccess: state.hostAccess }),
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentOperationRepository: () => ({
    findRun: async (id: string) => state.runs.get(id) ?? null,
    listRuns: async (filters: { userId?: string }) =>
      [...state.runs.values()].filter(
        (run) => !filters.userId || run.userId === filters.userId,
      ),
    listPendingApprovals: async () => [],
    listEvents: async () => [],
  }),
}));
vi.mock("../../../operations/catalog.js", () => ({
  buildCatalog: vi.fn(async () => ({
    actions: [{ id: "demo.restart" }],
    events: [],
    resources: [],
    signals: [],
  })),
}));
vi.mock("../../../operations/resources.js", () => ({
  flattenResourceRows: vi.fn(),
  readAcrossHosts: vi.fn(async () => []),
}));
vi.mock("../../../operations/gate.js", () => {
  class OperationError extends Error {
    status: number;
    constructor(
      readonly code: string,
      message: string,
      status = 403,
    ) {
      super(message);
      this.status = status;
    }
  }
  return {
    OperationError,
    runOperation: state.runOperation,
    decideOperationApproval: state.decide,
    cancelOperationRun: state.cancel,
  };
});

const { default: router } =
  await import("../../../database/routes/operations-routes.js");
const { OperationError } = await import("../../../operations/gate.js");

const app = express();
app.use(express.json());
app.use("/operations", router);

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  actionId: "demo.restart",
  pluginId: "demo",
  pluginVersion: "1.0.0",
  userId: "user-1",
  username: "name",
  origin: '{"kind":"ui"}',
  hostId: 1,
  hostName: "web",
  batchId: null,
  dryRun: false,
  risk: "change",
  status: "success",
  summary: "done",
  changed: true,
  input: '{"token":"[redacted]"}',
  sealedInput: "sealed:secret",
  output: null,
  undoInput: null,
  error: null,
  errorCode: null,
  undoOf: null,
  createdAt: "2026-01-01",
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

beforeEach(() => {
  state.userId = "user-1";
  state.apiKeyId = undefined;
  state.apiKeyScopes = undefined;
  state.actingAdminUserId = undefined;
  state.viewAll = false;
  state.hostAccess = false;
  state.runs.clear();
  state.runOperation.mockReset();
  state.runOperation.mockResolvedValue({ runId: "r", status: "success" });
  state.decide.mockReset();
  state.decide.mockResolvedValue({ runId: "r", status: "success" });
});

describe("POST /operations/:id/run", () => {
  it("passes a session as a ui origin", async () => {
    await request(app)
      .post("/operations/demo.restart/run")
      .send({ hostId: 1, input: { name: "x" } })
      .expect(200);
    expect(state.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "demo.restart",
        hostId: 1,
        userId: "user-1",
        origin: { kind: "ui" },
      }),
    );
  });

  it("passes a key as an api origin with its scopes", async () => {
    state.apiKeyId = "key";
    state.apiKeyScopes = ["operations:read"];
    await request(app)
      .post("/operations/demo.restart/run")
      .send({})
      .expect(200);
    expect(state.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { kind: "api" },
        apiKeyScopes: ["operations:read"],
      }),
    );
  });

  it("does not take the user or origin from the body", async () => {
    await request(app)
      .post("/operations/demo.restart/run")
      .send({ userId: "admin", origin: { kind: "plugin", via: "automation" } })
      .expect(200);
    expect(state.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", origin: { kind: "ui" } }),
    );
  });

  it("sends a refusal's status and code", async () => {
    state.runOperation.mockRejectedValue(
      new (
        OperationError as never as new (code: string, message: string) => Error
      )("FORBIDDEN", "No"),
    );
    const response = await request(app)
      .post("/operations/demo.restart/run")
      .send({})
      .expect(403);
    expect(response.body).toMatchObject({ code: "FORBIDDEN", error: "No" });
  });
});

describe("runs", () => {
  it("never returns the sealed input", async () => {
    state.runs.set("run-1", run());
    const response = await request(app)
      .get("/operations/runs/run-1")
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("hides another user's run", async () => {
    state.runs.set("run-1", run({ userId: "someone" }));
    await request(app).get("/operations/runs/run-1").expect(404);
  });

  it("shows a run to someone who manages its host", async () => {
    state.runs.set("run-1", run({ userId: "someone" }));
    state.hostAccess = true;
    await request(app).get("/operations/runs/run-1").expect(200);
  });

  it("lists only a user's own runs", async () => {
    state.runs.set("a", run({ id: "a" }));
    state.runs.set("b", run({ id: "b", userId: "someone" }));
    const response = await request(app).get("/operations/runs").expect(200);
    expect(response.body.runs.map((row: { id: string }) => row.id)).toEqual([
      "a",
    ]);
  });

  it("lists everything with the view permission", async () => {
    state.viewAll = true;
    state.runs.set("a", run({ id: "a" }));
    state.runs.set("b", run({ id: "b", userId: "someone" }));
    const response = await request(app).get("/operations/runs").expect(200);
    expect(response.body.runs).toHaveLength(2);
  });

  it("does not cancel another user's run", async () => {
    state.runs.set("run-1", run({ userId: "someone" }));
    await request(app).post("/operations/runs/run-1/cancel").expect(404);
    expect(state.cancel).not.toHaveBeenCalled();
  });
});

describe("POST /operations/approvals/:id", () => {
  it("needs a clear answer", async () => {
    await request(app)
      .post("/operations/approvals/a")
      .send({ approve: "yes" })
      .expect(400);
    expect(state.decide).not.toHaveBeenCalled();
  });

  it("refuses a scoped key", async () => {
    state.apiKeyScopes = ["operations:run"];
    await request(app)
      .post("/operations/approvals/a")
      .send({ approve: true })
      .expect(403);
    expect(state.decide).not.toHaveBeenCalled();
  });

  it("marks an impersonated request", async () => {
    state.actingAdminUserId = "admin";
    await request(app)
      .post("/operations/approvals/a")
      .send({ approve: true })
      .expect(200);
    expect(state.decide).toHaveBeenCalledWith(
      expect.objectContaining({ impersonated: true }),
    );
  });
});

describe("GET /operations/catalog", () => {
  it("answers", async () => {
    const response = await request(app).get("/operations/catalog").expect(200);
    expect(response.body.actions).toEqual([{ id: "demo.restart" }]);
  });
});
