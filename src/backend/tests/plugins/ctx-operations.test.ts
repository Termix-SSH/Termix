import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../../plugins/manifest.js";

const gate = vi.hoisted(() => ({
  runOperation: vi.fn(async () => ({ runId: "r", status: "success" })),
  drainPlugin: vi.fn(async () => {}),
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
