import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, Router } from "express";
import type { AutomationDefinition } from "../../../../types/automations.js";

/**
 * Route-level behaviour: validation, ownership and webhook token handling. The repository and engine are mocked; what matters here is what
 * the HTTP layer accepts, rejects and hands back.
 */

const state = vi.hoisted(() => ({
  currentUserId: "user-1",
  rows: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const repository = vi.hoisted(() => ({
  list: vi.fn(),
  findForUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  listAllEnabled: vi.fn(),
  listRuns: vi.fn(),
  findRunForUser: vi.fn(),
  listRunSteps: vi.fn(),
  upsertSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentAutomationRepository: () => repository,
}));

const run = vi.hoisted(() => vi.fn());
vi.mock("../../../automations/engine.js", () => ({
  AutomationEngine: { getInstance: () => ({ run }) },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      requirePermission:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.userId = state.currentUserId;
          next();
        },
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => undefined),
  getAuditUsername: vi.fn(async () => "alice"),
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const { default: router } =
  await import("../../../database/routes/automations.js");

function findHandler(method: string, path: string) {
  const stack = (router as unknown as Router).stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
    };
  }>;
  const layer = stack.find(
    (l) => l.route?.path === path && l.route?.methods[method],
  );
  if (!layer?.route) throw new Error(`No route for ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/** Runs the whole middleware chain for the route, not just its handler. */
async function invoke(
  method: string,
  path: string,
  overrides: {
    body?: Record<string, unknown>;
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
) {
  const stack = (router as unknown as Router).stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  }>;
  const layer = stack.find(
    (l) => l.route?.path === path && l.route?.methods[method],
  );
  if (!layer?.route) throw new Error(`No route for ${method} ${path}`);

  const req = {
    userId: state.currentUserId,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: {},
  } as unknown as Request;

  const res = {
    statusCode: 200,
    jsonBody: null as unknown,
    status(code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      (this as unknown as { jsonBody: unknown }).jsonBody = payload;
      return this;
    },
  } as unknown as Response & { statusCode: number; jsonBody: unknown };

  for (const entry of layer.route.stack) {
    let advanced = false;
    await entry.handle(req, res, () => {
      advanced = true;
    });
    if (!advanced) break;
  }

  return res as unknown as {
    statusCode: number;
    jsonBody: Record<string, unknown> | null;
  };
}

function definition(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    version: 1,
    trigger: {
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    },
    steps: [{ id: "a", type: "notify", channelIds: [1] }],
    ...overrides,
  } as AutomationDefinition;
}

beforeEach(() => {
  state.currentUserId = "user-1";
  state.rows = [];
  state.nextId = 1;
  vi.clearAllMocks();

  repository.list.mockImplementation(async (userId: string) =>
    state.rows.filter((row) => row.user_id === userId),
  );
  repository.findForUser.mockImplementation(
    async (id: number, userId: string) =>
      state.rows.find((row) => row.id === id && row.user_id === userId) ?? null,
  );
  repository.create.mockImplementation(
    async (input: Record<string, unknown>) => {
      const row = {
        id: state.nextId++,
        user_id: input.userId,
        name: input.name,
        definition: input.definition,
        enabled: input.enabled === false ? 0 : 1,
        channels: input.channels ?? [],
      };
      state.rows.push(row);
      return row;
    },
  );
  repository.delete.mockImplementation(async (id: number, userId: string) => {
    const index = state.rows.findIndex(
      (row) => row.id === id && row.user_id === userId,
    );
    if (index === -1) return false;
    state.rows.splice(index, 1);
    return true;
  });
  repository.listAllEnabled.mockImplementation(async () =>
    state.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      definition: row.definition,
      enabled: true,
    })),
  );
  repository.upsertSchedule.mockResolvedValue(undefined);
  repository.deleteSchedule.mockResolvedValue(undefined);
  run.mockResolvedValue({ runId: 1, status: "success" });
});

describe("POST /", () => {
  it("creates an automation from a valid definition", async () => {
    const res = await invoke("post", "/", {
      body: { name: "Disk watch", definition: definition() },
    });

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody?.name).toBe("Disk watch");
  });

  it("requires a name", async () => {
    const res = await invoke("post", "/", {
      body: { definition: definition() },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/name/i);
  });

  it("rejects an unknown trigger kind", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: { version: 1, trigger: { kind: "nope" }, steps: [] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/trigger/i);
  });

  it("rejects an unknown operator", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: definition({
          trigger: {
            kind: "metric_threshold",
            hostSelector: { kind: "all" },
            metric: { path: "cpu.percent" },
            operator: "~=",
            value: 1,
            cooldownMinutes: 5,
          },
        } as Partial<AutomationDefinition>),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/operator/i);
  });

  it("rejects an unknown step type", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: definition({
          steps: [{ id: "a", type: "launch_missiles" }],
        } as Partial<AutomationDefinition>),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/step type/i);
  });

  it("rejects duplicate step ids, including inside a branch", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: definition({
          steps: [
            { id: "dup", type: "wait", seconds: 1 },
            {
              id: "branch",
              type: "if",
              condition: { left: "1", operator: "==", right: "1" },
              then: [{ id: "dup", type: "wait", seconds: 1 }],
            },
          ],
        } as Partial<AutomationDefinition>),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/duplicate/i);
  });

  it("rejects an invalid cron expression", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: definition({
          trigger: { kind: "schedule", cron: "not a cron" },
        } as Partial<AutomationDefinition>),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/cron/i);
  });

  it("rejects an interval under a minute", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Bad",
        definition: definition({
          trigger: { kind: "schedule", intervalSeconds: 5 },
        } as Partial<AutomationDefinition>),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.jsonBody?.error)).toMatch(/60 seconds/i);
  });

  it("registers a schedule for a schedule trigger", async () => {
    await invoke("post", "/", {
      body: {
        name: "Nightly",
        definition: definition({
          trigger: { kind: "schedule", cron: "0 2 * * *" },
        } as Partial<AutomationDefinition>),
      },
    });
    expect(repository.upsertSchedule).toHaveBeenCalled();
  });

  it("returns a webhook token once and stores only its hash", async () => {
    const res = await invoke("post", "/", {
      body: {
        name: "Hooked",
        definition: definition({
          trigger: { kind: "webhook", tokenHash: "" },
        } as Partial<AutomationDefinition>),
      },
    });

    expect(res.statusCode).toBe(201);
    const token = res.jsonBody?.webhookToken as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    const stored = JSON.parse(state.rows[0].definition as string);
    expect(stored.trigger.tokenHash).not.toBe(token);
    expect(stored.trigger.tokenHash).toBe(
      crypto.createHash("sha256").update(token).digest("hex"),
    );

    // The hash is never echoed back to the client.
    const body = res.jsonBody as { definition: AutomationDefinition };
    expect((body.definition.trigger as { tokenHash: string }).tokenHash).toBe(
      "",
    );
  });

  it("stores the automation against the caller, not a supplied user id", async () => {
    // Authorization here is ownership, the same as the other data routes:
    // every read and write is scoped to req.userId, so a client cannot create
    // an automation that belongs to somebody else.
    await invoke("post", "/", {
      body: {
        name: "Mine",
        definition: definition(),
        userId: "user-2",
        user_id: "user-2",
      },
    });

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].user_id).toBe("user-1");
  });
});

describe("GET /", () => {
  it("only returns the caller's automations", async () => {
    state.rows.push({
      id: 1,
      user_id: "user-2",
      name: "Theirs",
      definition: JSON.stringify(definition()),
      channels: [],
    });

    const res = await invoke("get", "/");
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toHaveLength(0);
  });
});

describe("DELETE /:id", () => {
  it("will not delete another user's automation", async () => {
    state.rows.push({
      id: 1,
      user_id: "user-2",
      name: "Theirs",
      definition: JSON.stringify(definition()),
      channels: [],
    });

    const res = await invoke("delete", "/:id", { params: { id: "1" } });
    expect(res.statusCode).toBe(404);
    expect(state.rows).toHaveLength(1);
  });
});

describe("POST /:id/run", () => {
  function seedOwned() {
    state.rows.push({
      id: 1,
      user_id: "user-1",
      name: "Mine",
      definition: JSON.stringify(definition()),
      channels: [],
    });
  }

  it("runs an owned automation", async () => {
    seedOwned();
    const res = await invoke("post", "/:id/run", { params: { id: "1" } });

    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: 1, triggerType: "manual" }),
    );
  });

  it("passes the dry-run flag through", async () => {
    seedOwned();
    await invoke("post", "/:id/run", {
      params: { id: "1" },
      body: { dryRun: true },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("refuses to run someone else's automation", async () => {
    state.rows.push({
      id: 1,
      user_id: "user-2",
      name: "Theirs",
      definition: JSON.stringify(definition()),
      channels: [],
    });

    const res = await invoke("post", "/:id/run", { params: { id: "1" } });
    expect(res.statusCode).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("POST /webhook/:token", () => {
  function seedWebhook(token: string) {
    state.rows.push({
      id: 1,
      user_id: "user-1",
      name: "Hooked",
      definition: JSON.stringify(
        definition({
          trigger: {
            kind: "webhook",
            tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          },
        } as Partial<AutomationDefinition>),
      ),
      channels: [],
    });
  }

  it("runs the automation matching the token", async () => {
    const token = "a".repeat(64);
    seedWebhook(token);

    const res = await invoke("post", "/webhook/:token", {
      params: { token },
      body: { hello: "world" },
    });

    expect(res.statusCode).toBe(202);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: 1, triggerType: "webhook" }),
    );
  });

  it("rejects a token that does not match", async () => {
    seedWebhook("a".repeat(64));

    const res = await invoke("post", "/webhook/:token", {
      params: { token: "b".repeat(64) },
    });

    expect(res.statusCode).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a token too short to be real", async () => {
    seedWebhook("a".repeat(64));

    const res = await invoke("post", "/webhook/:token", {
      params: { token: "short" },
    });

    expect(res.statusCode).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});
