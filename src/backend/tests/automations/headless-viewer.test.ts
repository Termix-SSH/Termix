import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationWatchedHosts = vi.fn();
vi.mock("../../automations/triggers.js", () => ({
  listAutomationWatchedHosts: () => listAutomationWatchedHosts(),
}));

const {
  automationSessionId,
  reconcileHeadlessViewers,
  releaseHeadlessViewers,
  setViewerRegistry,
} = await import("../../automations/headless-viewer.js");

const registry = {
  registerViewer: vi.fn(),
  unregisterViewer: vi.fn(),
  updateHeartbeat: vi.fn(() => true),
};

beforeEach(() => {
  // Drop any viewers the previous test left behind before the mocks are
  // cleared, so those unregister calls are not counted against this test.
  releaseHeadlessViewers();
  vi.clearAllMocks();
  setViewerRegistry(registry);
  listAutomationWatchedHosts.mockResolvedValue(new Map());
});

describe("reconcileHeadlessViewers", () => {
  it("registers a synthetic viewer for each watched host", async () => {
    listAutomationWatchedHosts.mockResolvedValue(
      new Map([
        [7, "user-1"],
        [9, "user-2"],
      ]),
    );

    const result = await reconcileHeadlessViewers();

    expect(result.added).toBe(2);
    expect(registry.registerViewer).toHaveBeenCalledWith(
      7,
      "automation:7",
      "user-1",
    );
    expect(registry.registerViewer).toHaveBeenCalledWith(
      9,
      "automation:9",
      "user-2",
    );
  });

  it("heartbeats instead of re-registering a host it already holds", async () => {
    listAutomationWatchedHosts.mockResolvedValue(new Map([[7, "user-1"]]));
    await reconcileHeadlessViewers();
    registry.registerViewer.mockClear();

    const second = await reconcileHeadlessViewers();

    // The 120s reaper drops viewers with a stale heartbeat, so every tick has
    // to refresh the ones it is keeping.
    expect(registry.updateHeartbeat).toHaveBeenCalledWith("automation:7");
    expect(registry.registerViewer).not.toHaveBeenCalled();
    expect(second.added).toBe(0);
    expect(second.active).toBe(1);
  });

  it("releases a viewer once no automation watches the host", async () => {
    listAutomationWatchedHosts.mockResolvedValue(new Map([[7, "user-1"]]));
    await reconcileHeadlessViewers();

    listAutomationWatchedHosts.mockResolvedValue(new Map());
    const result = await reconcileHeadlessViewers();

    expect(result.removed).toBe(1);
    expect(result.active).toBe(0);
    expect(registry.unregisterViewer).toHaveBeenCalledWith(7, "automation:7");
  });

  it("does nothing when no registry has been wired up", async () => {
    setViewerRegistry(null);
    listAutomationWatchedHosts.mockResolvedValue(new Map([[7, "user-1"]]));

    const result = await reconcileHeadlessViewers();

    expect(result).toEqual({ added: 0, removed: 0, active: 0 });
    expect(registry.registerViewer).not.toHaveBeenCalled();
  });

  it("keeps going when the watch list cannot be loaded", async () => {
    listAutomationWatchedHosts.mockRejectedValue(new Error("db down"));
    await expect(reconcileHeadlessViewers()).resolves.toMatchObject({
      added: 0,
    });
  });

  it("survives a registry that throws on register", async () => {
    listAutomationWatchedHosts.mockResolvedValue(
      new Map([
        [7, "user-1"],
        [8, "user-1"],
      ]),
    );
    registry.registerViewer.mockImplementationOnce(() => {
      throw new Error("nope");
    });

    const result = await reconcileHeadlessViewers();

    // One host failing must not stop the other from being registered.
    expect(result.added).toBe(1);
  });
});

describe("releaseHeadlessViewers", () => {
  it("drops every viewer it is holding", async () => {
    listAutomationWatchedHosts.mockResolvedValue(
      new Map([
        [7, "user-1"],
        [8, "user-1"],
      ]),
    );
    await reconcileHeadlessViewers();

    releaseHeadlessViewers();

    expect(registry.unregisterViewer).toHaveBeenCalledTimes(2);
  });
});

describe("automationSessionId", () => {
  it("namespaces the session so it cannot collide with a real viewer", () => {
    expect(automationSessionId(42)).toBe("automation:42");
  });
});
