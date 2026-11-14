import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../../plugins/manifest.js";

const gate = vi.hoisted(() => ({
  runOperation: vi.fn(async () => ({ runId: "r", status: "success" })),
  drainPlugin: vi.fn(async () => {}),
  decideOperationApproval: vi.fn(async () => ({
    runId: "r",
    status: "success",
  })),
}));

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../operations/gate.js", () => ({
  ...gate,
  OperationError: class extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
}));
const runAccess = vi.hoisted(() => ({
  cancelRunAs: vi.fn(async (): Promise<boolean | null> => true),
  undoRunAs: vi.fn(
    async (): Promise<{ runId: string; status: string } | null> => ({
      runId: "u",
      status: "success",
    }),
  ),
}));
vi.mock("../../operations/run-access.js", () => runAccess);
vi.mock("../../operations/catalog.js", () => ({
  buildCatalog: vi.fn(async () => ({ actions: [] })),
}));
vi.mock("../../operations/events.js", () => ({
  emitOperationEvent: vi.fn(async () => {}),
  subscribeOperationEvents: vi.fn(() => () => {}),
}));
vi.mock("../../plugins/permissions.js", () => ({
  assertCapability: vi.fn(
    async (_id: string, capability: string, declared: string[]) => {
      if (!declared.includes(capability)) throw new Error("refused");
    },
  ),
  capabilityRefused: (pluginId: string, capability: string) =>
    new Error(`${pluginId} lacks ${capability}`),
}));

const { createPluginOperations } =
  await import("../../plugins/ctx-operations.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { clearOperationRegistry, getAction } =
  await import("../../operations/registry.js");
const { runAsActor } = await import("../../plugins/actor.js");

const action = {
  id: "demo.restart",
  titleKey: "t",
  scope: "host",
  risk: "change",
  permission: "use",
  hostAccess: "edit",
};

function build(capabilities: string[], invokes?: string[]) {
  const bag = new DisposableBag("demo");
  const manifest = {
    id: "demo",
    capabilities,
    contributes: { operations: { actions: [action], invokes } },
  } as unknown as PluginManifest;
  return { bag, operations: createPluginOperations({ manifest, bag }) };
}

const handler = { run: async () => ({ summary: "ok" }) };

beforeEach(() => {
  clearOperationRegistry();
  gate.runOperation.mockClear();
  gate.drainPlugin.mockClear();
});

describe("register", () => {
  it("needs the capability", () => {
    const { operations } = build([]);
    expect(() => operations.register("demo.restart", handler)).toThrow(
      "operations:provide",
    );
  });

  it("refuses an undeclared action", () => {
    const { operations } = build(["operations:provide"]);
    expect(() => operations.register("demo.other", handler)).toThrow(
      "not declared",
    );
  });

  it("drains, then revokes, when the plugin stops", async () => {
    const { bag, operations } = build(["operations:provide"]);
    operations.register("demo.restart", handler);
    expect(getAction("demo.restart")).toBeDefined();

    await bag.disposeAll();
    expect(gate.drainPlugin).toHaveBeenCalledWith("demo");
    expect(getAction("demo.restart")).toBeUndefined();
  });

  it("keeps the new handler when an old disposer runs after a restart", async () => {
    const first = build(["operations:provide"]);
    first.operations.register("demo.restart", handler);
    const second = build(["operations:provide"]);
    const fresh = { run: async () => ({ summary: "new" }) };
    second.operations.register("demo.restart", fresh);

    await first.bag.disposeAll();
    expect(getAction("demo.restart")?.handler).toBe(fresh);
  });
});

describe("invoke", () => {
  const asUser = <T>(fn: () => Promise<T>) =>
    runAsActor("user", "request", fn, undefined, {
      origin: { kind: "ui" },
      apiKeyScopes: ["operations:read"],
    });

  it("needs the capability", async () => {
    const { operations } = build([], ["*"]);
    await expect(
      asUser(() => operations.invoke("docker.restart")),
    ).rejects.toThrow("refused");
  });

  it("only reaches what the manifest lists", async () => {
    const { operations } = build(["operations:invoke"], ["docker.*"]);
    await expect(
      asUser(() => operations.invoke("firewall.allow")),
    ).rejects.toThrow("did not declare");
    expect(gate.runOperation).not.toHaveBeenCalled();
  });

  it("names the plugin as origin and keeps the key's limits", async () => {
    const { operations } = build(["operations:invoke"], ["docker.*"]);
    await asUser(() =>
      operations.invoke("docker.restart", { via: "automation" }),
    );
    expect(gate.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        origin: { kind: "plugin", pluginId: "demo", via: "automation" },
        apiKeyScopes: ["operations:read"],
      }),
    );
  });

  it("does not let a plugin pick its own origin", async () => {
    const { operations } = build(["operations:invoke"], ["*"]);
    await asUser(() =>
      operations.invoke("docker.restart", {
        origin: { kind: "ui" },
      } as never),
    );
    expect(gate.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: expect.objectContaining({ kind: "plugin", pluginId: "demo" }),
      }),
    );
  });

  it("needs an acting user", async () => {
    const { operations } = build(["operations:invoke"], ["*"]);
    await expect(operations.invoke("docker.restart")).rejects.toThrow(
      "acting user",
    );
  });
});

describe("run", () => {
  it("keeps the caller as origin for a plugin's own action", async () => {
    const { operations } = build(["operations:provide"]);
    await runAsActor(
      "user",
      "request",
      () => operations.run("demo.restart", { hostId: 1 }),
      undefined,
      { origin: { kind: "ui" } },
    );
    expect(gate.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { kind: "ui" }, hostId: 1 }),
    );
  });

  it("refuses another plugin's action", async () => {
    const { operations } = build(["operations:provide"]);
    await expect(
      runAsActor("user", "request", () => operations.run("docker.restart")),
    ).rejects.toThrow("not declared");
  });
});

describe("emit", () => {
  it("refuses an undeclared event", async () => {
    const { operations } = build(["operations:provide"]);
    await expect(operations.emit("demo.nothing")).rejects.toThrow(
      "not declared",
    );
  });
});

describe("approvals", () => {
  it("needs the capability", () => {
    const { operations } = build([]);
    expect(() => operations.approvals.provide(() => null)).toThrow(
      "operations:approve",
    );
  });
});

describe("approvals.decide", () => {
  type Decide = (input: unknown, request?: unknown) => Promise<unknown>;
  const decide = (capabilities: string[]) =>
    build(capabilities).operations.approvals.decide as unknown as Decide;
  const input = { approvalId: "a1", approve: true, comment: "ok" };

  beforeEach(() => gate.decideOperationApproval.mockClear());

  it("needs the capability", async () => {
    await expect(decide([])(input, { userId: "u1" })).rejects.toThrow(
      "operations:approve",
    );
  });

  it("works only inside one of the plugin's own requests", async () => {
    await expect(decide(["operations:approve"])(input)).rejects.toThrow(
      "own requests",
    );
    expect(gate.decideOperationApproval).not.toHaveBeenCalled();
  });

  it("refuses a request made with an API key", async () => {
    const run = decide(["operations:approve"]);
    await expect(
      run(input, { userId: "u1", apiKeyId: "k", apiKeyScopes: ["full"] }),
    ).rejects.toThrow("API key");
    await expect(
      run(input, { userId: "u1", apiKeyScopes: ["operations:run"] }),
    ).rejects.toThrow("API key");
    expect(gate.decideOperationApproval).not.toHaveBeenCalled();
  });

  it("decides as the person on the request, never as anyone the plugin names", async () => {
    await decide(["operations:approve"])(
      { ...input, approverId: "admin" },
      { userId: "u1", actingAdminUserId: "a9" },
    );
    expect(gate.decideOperationApproval).toHaveBeenCalledWith({
      approvalId: "a1",
      approverId: "u1",
      approve: true,
      comment: "ok",
      impersonated: true,
    });
  });

  it("needs an id and a yes or no", async () => {
    await expect(
      decide(["operations:approve"])({ approvalId: "a1" }, { userId: "u1" }),
    ).rejects.toThrow("required");
  });
});

describe("runs", () => {
  type Call = (input: unknown, request?: unknown) => Promise<unknown>;
  const runs = (capabilities: string[]) =>
    build(capabilities).operations.runs as unknown as {
      cancel: Call;
      undo: Call;
    };

  beforeEach(() => {
    runAccess.cancelRunAs.mockClear();
    runAccess.undoRunAs.mockClear();
  });

  it("needs the capability", async () => {
    await expect(
      runs([]).cancel({ runId: "r1" }, { userId: "u1" }),
    ).rejects.toThrow("refused");
    await expect(
      runs([]).undo({ runId: "r1" }, { userId: "u1" }),
    ).rejects.toThrow("refused");
  });

  it("works only inside one of the plugin's own requests", async () => {
    const { cancel, undo } = runs(["operations:invoke"]);
    await expect(cancel({ runId: "r1" })).rejects.toThrow("own requests");
    await expect(undo({ runId: "r1" })).rejects.toThrow("own requests");
    expect(runAccess.cancelRunAs).not.toHaveBeenCalled();
    expect(runAccess.undoRunAs).not.toHaveBeenCalled();
  });

  it("refuses a request made with an API key", async () => {
    const { cancel, undo } = runs(["operations:invoke"]);
    await expect(
      cancel({ runId: "r1" }, { userId: "u1", apiKeyId: "k" }),
    ).rejects.toThrow("API keys");
    await expect(
      undo({ runId: "r1" }, { userId: "u1", apiKeyScopes: ["full"] }),
    ).rejects.toThrow("API keys");
    expect(runAccess.cancelRunAs).not.toHaveBeenCalled();
    expect(runAccess.undoRunAs).not.toHaveBeenCalled();
  });

  it("acts as the person on the request, never anyone the plugin names", async () => {
    const { cancel, undo } = runs(["operations:invoke"]);
    await expect(
      cancel({ runId: "r1", userId: "admin" }, { userId: "u1" }),
    ).resolves.toEqual({ cancelled: true });
    expect(runAccess.cancelRunAs).toHaveBeenCalledWith("r1", "u1");
    await undo(
      { runId: "r1", confirmed: true, userId: "admin" },
      { userId: "u1" },
    );
    expect(runAccess.undoRunAs).toHaveBeenCalledWith({
      runId: "r1",
      userId: "u1",
      origin: { kind: "ui" },
      confirmed: true,
    });
  });

  it("answers not found for a run the person can't see", async () => {
    const { cancel, undo } = runs(["operations:invoke"]);
    runAccess.cancelRunAs.mockResolvedValueOnce(null);
    runAccess.undoRunAs.mockResolvedValueOnce(null);
    await expect(cancel({ runId: "r1" }, { userId: "u1" })).rejects.toThrow(
      "Run not found",
    );
    await expect(undo({ runId: "r1" }, { userId: "u1" })).rejects.toThrow(
      "Nothing to undo",
    );
  });

  it("needs a run id", async () => {
    await expect(
      runs(["operations:invoke"]).cancel({}, { userId: "u1" }),
    ).rejects.toThrow("runId");
  });
});
