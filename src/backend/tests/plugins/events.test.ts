import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { pluginEvents, TOPICS } = await import("../../plugins/events.js");

describe("plugin event bus", () => {
  afterEach(() => {
    pluginEvents.clear();
    vi.clearAllMocks();
  });

  it("delivers a payload to every subscriber of a topic", () => {
    const first = vi.fn();
    const second = vi.fn();

    pluginEvents.on("topic.a", first);
    pluginEvents.on("topic.a", second);
    pluginEvents.emit("topic.a", { value: 1 });

    expect(first).toHaveBeenCalledWith({ value: 1 });
    expect(second).toHaveBeenCalledWith({ value: 1 });
  });

  it("does not deliver across topics", () => {
    const listener = vi.fn();
    pluginEvents.on("topic.a", listener);
    pluginEvents.emit("topic.b", {});

    expect(listener).not.toHaveBeenCalled();
  });

  it("emitting a topic with no subscribers is a no-op", () => {
    expect(() => pluginEvents.emit("nobody.listening", {})).not.toThrow();
  });

  it("unsubscribes and cleans up the empty topic", () => {
    const listener = vi.fn();
    const off = pluginEvents.on("topic.a", listener);

    expect(pluginEvents.listenerCount("topic.a")).toBe(1);
    off();
    expect(pluginEvents.listenerCount("topic.a")).toBe(0);

    pluginEvents.emit("topic.a", {});
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing subscriber does not stop the others or the caller", async () => {
    const after = vi.fn();
    pluginEvents.on("topic.a", () => {
      throw new Error("subscriber exploded");
    });
    pluginEvents.on("topic.a", after);

    expect(() => pluginEvents.emit("topic.a", {})).not.toThrow();
    expect(after).toHaveBeenCalled();

    const { pluginLogger } = await import("../../utils/logger.js");
    expect(pluginLogger.error).toHaveBeenCalled();
  });

  it("a rejecting async subscriber is reported, not left unhandled", async () => {
    pluginEvents.on("topic.a", async () => {
      throw new Error("async subscriber exploded");
    });

    expect(() => pluginEvents.emit("topic.a", {})).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    const { pluginLogger } = await import("../../utils/logger.js");
    expect(pluginLogger.error).toHaveBeenCalled();
  });

  it("a subscriber added during an emit does not receive that same emit", () => {
    const late = vi.fn();
    pluginEvents.on("topic.a", () => {
      pluginEvents.on("topic.a", late);
    });

    pluginEvents.emit("topic.a", {});
    expect(late).not.toHaveBeenCalled();

    pluginEvents.emit("topic.a", {});
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("exposes the internal topic names the server publishes", () => {
    expect(TOPICS.hostSessionStatus).toBe("host.session.status");
    expect(TOPICS.internalEvent).toBe("internal.event");
    expect(TOPICS.hostStatus).toBe("host.status");
    expect(TOPICS.hostKeyUpdated).toBe("host.key.updated");
  });
});

describe("hosts publishers route through the bus", () => {
  // No vi.resetModules() here: the bus is a module singleton, and resetting
  // would hand these imports a different instance than the one subscribed to.
  afterEach(() => {
    pluginEvents.clear();
  });

  it("notifyAutomationInternalEvent emits internal.event", async () => {
    const { notifyAutomationInternalEvent } =
      await import("../../hosts/automation-events.js");
    const listener = vi.fn();
    pluginEvents.on(TOPICS.internalEvent, listener);

    notifyAutomationInternalEvent("host_deleted", "user-1", 42, { a: 1 });

    expect(listener).toHaveBeenCalledWith({
      event: "host_deleted",
      userId: "user-1",
      hostId: 42,
      details: { a: 1 },
    });
  });

  it("notifyAutomationInternalEvent ignores a missing userId", async () => {
    const { notifyAutomationInternalEvent } =
      await import("../../hosts/automation-events.js");
    const listener = vi.fn();
    pluginEvents.on(TOPICS.internalEvent, listener);

    notifyAutomationInternalEvent("host_deleted", "");
    expect(listener).not.toHaveBeenCalled();
  });

  it("hostSessionStatus publishes host.session.status on the refcount edges", async () => {
    const { HostSessionStatus } =
      await import("../../hosts/host-session-status.js");
    const seen: unknown[] = [];
    pluginEvents.on(TOPICS.hostSessionStatus, (p) => seen.push(p));

    const status = new HostSessionStatus();
    const releaseFirst = status.register(7);
    const releaseSecond = status.register(7);

    // Only the 0 -> 1 edge publishes.
    expect(seen).toEqual([{ hostId: 7, online: true }]);

    releaseFirst();
    expect(seen).toHaveLength(1);

    // ... and only the 1 -> 0 edge.
    releaseSecond();
    expect(seen).toEqual([
      { hostId: 7, online: true },
      { hostId: 7, online: false },
    ]);
  });
});
