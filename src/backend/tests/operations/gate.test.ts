import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationAction } from "@termix-ssh/plugin-sdk/operations";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  hostLevels: new Map<number, string>(),
  plugin: {
    state: "active",
    source: "bundled",
    signedTier: undefined as string | undefined,
    manifest: {
      version: "1.0.0",
      capabilities: ["operations:provide"],
    },
  },
  capability: true,
  safeMode: false,
  host: { name: "web", updatedAt: "2026-01-01", tags: ["prod"] } as {
    name: string;
    updatedAt: string;
    tags: string[];
  },
  runs: new Map<string, Record<string, unknown>>(),
  approvals: new Map<string, Record<string, unknown>>(),
  audits: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
}));
vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (text: string) => `sealed:${text}`,
  decryptSystemSecret: async (text: string) => text.slice("sealed:".length),
  isSystemEncrypted: (text: string) => text.startsWith("sealed:"),
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (userId: string, permission: string) =>
        state.permissions.has(`${userId}:${permission}`),
      canAccessHost: async (userId: string, hostId: number, level: string) => {
        const held = state.hostLevels.get(hostId);
        const rank = ["connect", "view", "edit", "manage"];
        return {
          hasAccess:
            held !== undefined && rank.indexOf(held) >= rank.indexOf(level),
        };
      },
    }),
  },
}));
vi.mock("../../plugins/permissions.js", () => ({
  hasCapability: async () => state.capability,
}));
vi.mock("../../plugins/safe-mode.js", () => ({
  safeModeOn: () => state.safeMode,
}));
vi.mock("../../plugins/manifest.js", () => ({
  qualifyPermission: (pluginId: string, name: string) =>
    name.startsWith(`${pluginId}.`) ? name : `${pluginId}.${name}`,
}));
vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({ loader: { get: () => state.plugin } }),
}));
vi.mock("../../plugins/host-status-provider.js", () => ({
  hostStatus: { get: () => null },
}));
vi.mock("../../plugins/ctx-probe.js", () => ({
  loadProbeTargets: async () => [],
}));
vi.mock("../../operations/hosts.js", () => ({
  loadOperationHost: async (id: number) => ({
    id,
    ...state.host,
    os: null,
    settings: {},
  }),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({ username: `name-${id}` }),
  }),
  createCurrentOperationRepository: () => ({
    insertRun: async (run: Record<string, unknown>) => {
      state.runs.set(run.id as string, { ...run });
    },
    findRun: async (id: string) => state.runs.get(id) ?? null,
    findByIdempotencyKey: async (userId: string, key: string) =>
      [...state.runs.values()].find(
        (run) => run.userId === userId && run.idempotencyKey === key,
      ) ?? null,
    updateRunFrom: async (
      id: string,
      from: string,
      patch: Record<string, unknown>,
    ) => {
      const run = state.runs.get(id);
      if (!run || run.status !== from) return false;
      Object.assign(run, patch);
      return true;
    },
    insertApproval: async (row: Record<string, unknown>) => {
      state.approvals.set(row.id as string, { ...row });
    },
    findApproval: async (id: string) => state.approvals.get(id) ?? null,
    findApprovalForRun: async (runId: string) =>
      [...state.approvals.values()].find((row) => row.runId === runId) ?? null,
    decideApproval: async (id: string, status: string) => {
      const row = state.approvals.get(id);
      if (!row || row.status !== "pending") return false;
      row.status = status;
      return true;
    },
    insertEvent: async (event: Record<string, unknown>) => {
      state.events.push(event);
    },
  }),
}));

const { registerAction, clearOperationRegistry } =
  await import("../../operations/registry.js");
const { provideApprovalPolicy, clearApprovalPolicies } =
  await import("../../operations/approvals.js");
const {
  cancelOperationRun,
  clearOperationGate,
  decideOperationApproval,
  drainPlugin,
  OperationError,
  OperationNeedsInteraction,
  runOperation,
} = await import("../../operations/gate.js");

const USER = "user-1";
const APPROVER = "user-2";

const action = (overrides: Partial<OperationAction> = {}): OperationAction => ({
  id: "demo.restart",
  titleKey: "t",
  scope: "host",
  risk: "change",
  permission: "use",
  hostAccess: "edit",
  inputs: [
    { key: "name", type: "string", required: true },
    { key: "token", type: "secret" },
  ],
  dryRun: "native",
  ...overrides,
});

function register(
  overrides: Partial<OperationAction> = {},
  run = vi.fn(async () => ({ summary: "done", changed: true })),
) {
  registerAction("demo", action(overrides), { run });
  return run;
}

const manifestForPolicy = {
  capabilities: ["operations:approve"],
} as never;

const base = {
  actionId: "demo.restart",
  hostId: 1,
  input: { name: "nginx" },
  userId: USER,
  origin: { kind: "ui" } as const,
};

async function refused(request: Parameters<typeof runOperation>[0]) {
  try {
    await runOperation(request);
  } catch (error) {
    expect(error).toBeInstanceOf(OperationError);
    return (error as InstanceType<typeof OperationError>).code;
  }
  throw new Error("Expected a refusal");
}

beforeEach(() => {
  state.permissions = new Set([`${USER}:demo.use`, `${APPROVER}:demo.use`]);
  state.hostLevels = new Map([[1, "edit"]]);
  state.plugin.state = "active";
  state.plugin.source = "bundled";
  state.plugin.manifest.version = "1.0.0";
  state.capability = true;
  state.safeMode = false;
  state.host = { name: "web", updatedAt: "2026-01-01", tags: ["prod"] };
  state.runs.clear();
  state.approvals.clear();
  state.audits.length = 0;
  state.events.length = 0;
});

afterEach(() => {
  clearOperationRegistry();
  clearApprovalPolicies();
  clearOperationGate();
});

describe("refusals", () => {
  it("does not run an unknown action", async () => {
    expect(await refused(base)).toBe("NOT_FOUND");
  });

  it("does not run in safe mode", async () => {
    register();
    state.safeMode = true;
    expect(await refused(base)).toBe("SAFE_MODE");
  });

  it("does not run for a plugin that stopped", async () => {
    register();
    state.plugin.state = "disabled";
    expect(await refused(base)).toBe("UNAVAILABLE");
  });

  it("rechecks the grant at use", async () => {
    const run = register();
    state.capability = false;
    expect(await refused(base)).toBe("UNAVAILABLE");
    expect(run).not.toHaveBeenCalled();
  });

  it("needs the role permission", async () => {
    const run = register();
    state.permissions.clear();
    expect(await refused(base)).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("needs the declared host level", async () => {
    const run = register();
    state.hostLevels.set(1, "connect");
    expect(await refused(base)).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses bad input before anything runs", async () => {
    const run = register();
    expect(await refused({ ...base, input: { nope: 1 } })).toBe(
      "INVALID_INPUT",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("needs a host for a host action", async () => {
    register();
    expect(await refused({ ...base, hostId: undefined })).toBe("INVALID_INPUT");
  });

  it("needs a confirm for destructive actions", async () => {
    register({ risk: "destructive" });
    expect(await refused(base)).toBe("NEEDS_CONFIRM");
    expect((await runOperation({ ...base, confirmed: true })).status).toBe(
      "success",
    );
  });

  it("stops long chains", async () => {
    register();
    expect(await refused({ ...base, depth: 4 })).toBe("TOO_DEEP");
  });
});

describe("api key scopes", () => {
  it("lets a read key run reads only", async () => {
    register();
    register({ id: "demo.read", risk: "read", hostAccess: "connect" });
    expect(await refused({ ...base, apiKeyScopes: ["operations:read"] })).toBe(
      "SCOPE",
    );
    const read = await runOperation({
      ...base,
      actionId: "demo.read",
      apiKeyScopes: ["operations:read"],
    });
    expect(read.status).toBe("success");
  });

  it("treats no scopes as full access", async () => {
    register();
    const outcome = await runOperation({ ...base, apiKeyScopes: null });
    expect(outcome.status).toBe("success");
  });
});

describe("runs", () => {
  it("records a run and never stores a secret", async () => {
    const run = register();
    const outcome = await runOperation({
      ...base,
      input: { name: "nginx", token: "hunter2" },
    });

    expect(outcome.status).toBe("success");
    expect(run.mock.calls[0]?.[0]).toMatchObject({ token: "hunter2" });
    const row = state.runs.get(outcome.runId!)!;
    expect(row.status).toBe("success");
    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(JSON.stringify(state.audits)).not.toContain("hunter2");
    expect(JSON.stringify(state.events)).not.toContain("hunter2");
  });

  it("keeps failures in the run, not thrown", async () => {
    register(
      {},
      vi.fn(async () => {
        throw new Error("no such unit");
      }),
    );
    const outcome = await runOperation(base);
    expect(outcome).toMatchObject({ status: "failed", error: "no such unit" });
    expect(state.runs.get(outcome.runId!)!.status).toBe("failed");
  });

  it("reports hosts that need a person", async () => {
    register(
      {},
      vi.fn(async () => {
        throw new OperationNeedsInteraction("Sign in first");
      }),
    );
    const outcome = await runOperation(base);
    expect(outcome.status).toBe("needs_interaction");
  });

  it("passes dry run to a native handler", async () => {
    const run = register();
    await runOperation({ ...base, dryRun: true });
    expect(run.mock.calls[0]).toBeDefined();
    expect(
      (run.mock.calls[0] as unknown as [unknown, { dryRun: boolean }])[1]
        .dryRun,
    ).toBe(true);
  });

  it("never calls run for a describe dry run", async () => {
    const run = vi.fn(async () => ({ summary: "x" }));
    registerAction("demo", action({ dryRun: "describe" }), {
      run,
      describe: () => "Would restart nginx",
    });
    const outcome = await runOperation({ ...base, dryRun: true });
    expect(outcome.summary).toBe("Would restart nginx");
    expect(run).not.toHaveBeenCalled();
  });

  it("drops sensitive outputs", async () => {
    register(
      { outputs: [{ key: "conf", type: "textarea", sensitive: true }] },
      vi.fn(async () => ({
        summary: "ok",
        data: { conf: "private key" },
      })),
    );
    const outcome = await runOperation(base);
    expect(JSON.stringify(outcome)).not.toContain("private key");
    expect(JSON.stringify(state.runs.get(outcome.runId!))).not.toContain(
      "private key",
    );
  });

  it("writes no row for a background read", async () => {
    register({ risk: "read", hostAccess: "connect" });
    const outcome = await runOperation({ ...base, internal: true });
    expect(outcome.runId).toBeNull();
    expect(state.runs.size).toBe(0);
  });

  it("does not run twice for one idempotency key", async () => {
    const run = register();
    const first = await runOperation({ ...base, idempotencyKey: "abc" });
    const second = await runOperation({ ...base, idempotencyKey: "abc" });
    expect(second.runId).toBe(first.runId);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("emits a run event for a change", async () => {
    register();
    await runOperation(base);
    await vi.waitFor(() =>
      expect(state.events[0]).toMatchObject({
        eventId: "operation.succeeded",
      }),
    );
  });

  it("stops a run on cancel", async () => {
    let started = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    register(
      {},
      vi.fn(
        (_input, context: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            started();
            context.signal.addEventListener("abort", () =>
              reject(new Error("stopped")),
            );
          }),
      ) as never,
    );
    const running = runOperation(base);
    await ready;
    const row = [...state.runs.values()][0]!;
    expect(await cancelOperationRun(row as never)).toBe(true);
    expect((await running).status).toBe("failed");
  });
});

describe("policy", () => {
  it("keeps AI and MCP away from changes with no rule", async () => {
    register();
    for (const via of ["assistant", "mcp"]) {
      expect(
        await refused({
          ...base,
          origin: { kind: "plugin", pluginId: "x", via },
        }),
      ).toBe("DENIED");
    }
  });

  it("refuses a plugin with no stated purpose", async () => {
    register();
    expect(
      await refused({ ...base, origin: { kind: "plugin", pluginId: "x" } }),
    ).toBe("DENIED");
  });

  it("lets a person's automation go by RBAC", async () => {
    register();
    const outcome = await runOperation({
      ...base,
      origin: { kind: "plugin", pluginId: "x", via: "automation" },
    });
    expect(outcome.status).toBe("success");
  });

  it("treats a community read as a change", async () => {
    state.plugin.source = "user";
    state.plugin.signedTier = "community";
    register({ risk: "read", hostAccess: "connect" });
    expect(
      await refused({
        ...base,
        origin: { kind: "plugin", pluginId: "x", via: "assistant" },
      }),
    ).toBe("DENIED");
    state.plugin.signedTier = undefined;
  });

  it("denies when a provider throws", async () => {
    register();
    provideApprovalPolicy("rules", manifestForPolicy, () => {
      throw new Error("boom");
    });
    expect(await refused(base)).toBe("DENIED");
  });

  it("takes the strictest answer", async () => {
    register();
    provideApprovalPolicy("a", manifestForPolicy, () => ({
      decision: "allow",
    }));
    provideApprovalPolicy("b", manifestForPolicy, () => ({
      decision: "deny",
      reason: "No",
    }));
    expect(await refused(base)).toBe("DENIED");
  });

  it("audits a denial", async () => {
    register();
    provideApprovalPolicy("a", manifestForPolicy, () => ({ decision: "deny" }));
    await refused(base);
    expect(state.audits[0]).toMatchObject({
      action: "operation_denied",
      success: false,
    });
  });
});

describe("approvals", () => {
  const needApproval = () =>
    provideApprovalPolicy("rules", manifestForPolicy, () => ({
      decision: "approve",
    }));

  async function pending(run = register()) {
    needApproval();
    const outcome = await runOperation({
      ...base,
      input: { name: "nginx", token: "hunter2" },
    });
    expect(outcome.status).toBe("pending_approval");
    expect(run).not.toHaveBeenCalled();
    return outcome;
  }

  const decide = (approvalId: string, approverId = APPROVER) =>
    decideOperationApproval({ approvalId, approverId, approve: true });

  it("runs the sealed input once approved, then wipes it", async () => {
    const run = register();
    const { approvalId, runId } = await pending(run);

    const row = state.runs.get(runId!)!;
    expect(row.input).not.toContain("hunter2");
    expect(row.sealedInput).toBeTruthy();

    const outcome = await decide(approvalId!);
    expect(outcome.status).toBe("success");
    expect(run.mock.calls[0]?.[0]).toMatchObject({ token: "hunter2" });
    expect(state.runs.get(runId!)!.sealedInput).toBeNull();
  });

  it("is one shot", async () => {
    const run = register();
    const { approvalId } = await pending(run);
    await decide(approvalId!);
    await expect(decide(approvalId!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let a person approve their own request", async () => {
    const { approvalId } = await pending();
    await expect(decide(approvalId!, USER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets a person approve what an AI asked for", async () => {
    register();
    needApproval();
    const outcome = await runOperation({
      ...base,
      origin: { kind: "plugin", pluginId: "x", via: "assistant" },
    });
    const done = await decide(outcome.approvalId!, USER);
    expect(done.status).toBe("success");
  });

  it("does not let someone impersonating approve", async () => {
    const { approvalId } = await pending();
    await expect(
      decideOperationApproval({
        approvalId: approvalId!,
        approverId: APPROVER,
        approve: true,
        impersonated: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs the approver to hold the action's rights", async () => {
    const { approvalId } = await pending();
    state.permissions.delete(`${APPROVER}:demo.use`);
    await expect(decide(approvalId!)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rechecks the requester when it runs", async () => {
    const run = register();
    const { approvalId, runId } = await pending(run);
    state.permissions.delete(`${USER}:demo.use`);
    await expect(decide(approvalId!)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(run).not.toHaveBeenCalled();
    expect(state.runs.get(runId!)!.status).toBe("rejected");
  });

  it("goes stale when the host changed", async () => {
    const run = register();
    const { approvalId } = await pending(run);
    state.host.updatedAt = "2026-02-02";
    await expect(decide(approvalId!)).rejects.toMatchObject({ code: "STALE" });
    expect(run).not.toHaveBeenCalled();
  });

  it("goes stale when the plugin changed", async () => {
    const run = register();
    const { approvalId } = await pending(run);
    state.plugin.manifest.version = "2.0.0";
    await expect(decide(approvalId!)).rejects.toMatchObject({ code: "STALE" });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a sealed copy from another run", async () => {
    const run = register();
    const first = await pending(run);
    const second = await runOperation(base);
    state.runs.get(second.runId!)!.sealedInput = state.runs.get(
      first.runId!,
    )!.sealedInput;
    await expect(decide(second.approvalId!)).rejects.toMatchObject({
      code: "STALE",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses an expired approval", async () => {
    const run = register();
    const { approvalId } = await pending(run);
    state.approvals.get(approvalId!)!.expiresAt = "2020-01-01T00:00:00.000Z";
    await expect(decide(approvalId!)).rejects.toMatchObject({ code: "STALE" });
    expect(run).not.toHaveBeenCalled();
  });

  it("wipes the sealed input on reject", async () => {
    const { approvalId, runId } = await pending();
    const outcome = await decideOperationApproval({
      approvalId: approvalId!,
      approverId: APPROVER,
      approve: false,
    });
    expect(outcome.status).toBe("rejected");
    expect(state.runs.get(runId!)!.sealedInput).toBeNull();
  });
});

describe("drain", () => {
  it("waits for a handler that is still stopping", async () => {
    let finish = () => {};
    register(
      {},
      vi.fn(
        () =>
          new Promise<never>((_, reject) => {
            finish = () => reject(new Error("closed"));
          }),
      ) as never,
    );
    vi.useFakeTimers();
    void runOperation(base).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    let drained = false;
    const draining = drainPlugin("demo").then(() => (drained = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drained).toBe(false);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    await draining;
    vi.useRealTimers();
    expect(drained).toBe(true);
  });

  it("stops running work and marks it interrupted", async () => {
    register({}, vi.fn(() => new Promise(() => {})) as never);
    vi.useFakeTimers();
    const running = runOperation(base);
    await vi.advanceTimersByTimeAsync(0);
    const draining = drainPlugin("demo");
    await vi.advanceTimersByTimeAsync(11_000);
    await draining;
    await running;
    vi.useRealTimers();
    expect([...state.runs.values()][0]!.status).toBe("interrupted");
  });

  it("refuses new runs while draining", async () => {
    register({}, vi.fn(() => new Promise(() => {})) as never);
    vi.useFakeTimers();
    void runOperation(base);
    await vi.advanceTimersByTimeAsync(0);
    const draining = drainPlugin("demo");
    await expect(runOperation(base)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(11_000);
    await draining;
    vi.useRealTimers();
  });
});
