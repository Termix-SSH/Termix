import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginServices } from "@termix/plugin-sdk/backend";

const fired = vi.hoisted(() => [] as unknown[]);

vi.mock("../../src/backend/triggers.js", () => ({
  onDockerEvent: async (event: unknown) => {
    fired.push(event);
  },
}));

vi.mock("../../../../src/backend/database/repositories/factory.js", () => ({
  createCurrentAutomationRepository: () => ({ listAllEnabled: async () => [] }),
}));

import {
  reconcileDockerWatch,
  resetDockerWatcher,
} from "../../src/backend/docker-watcher.js";
import {
  setDockerServices,
  runDockerAction,
} from "../../src/backend/docker.js";

type Listener = (event: {
  hostId: number;
  container: string;
  event: string;
}) => void;

/** A docker.events provider that records who subscribed to what. */
function fakeEvents() {
  const subscriptions = new Map<string, Set<Listener>>();
  const calls: Array<{ userId?: string; hostId: number }> = [];
  const services = {
    provide: () => {},
    providers: () => [],
    get: (name: string, options?: { userId?: string }) => {
      if (name !== "docker.events") return {};
      return {
        subscribe: async (hostId: number, listener: Listener) => {
          calls.push({ userId: options?.userId, hostId });
          const key = `${options?.userId}:${hostId}`;
          const set = subscriptions.get(key) ?? new Set<Listener>();
          set.add(listener);
          subscriptions.set(key, set);
          return () => set.delete(listener);
        },
      };
    },
  } as unknown as PluginServices;
  const emit = (key: string, event: Parameters<Listener>[0]) => {
    for (const listener of subscriptions.get(key) ?? []) listener(event);
  };
  return { services, subscriptions, calls, emit };
}

beforeEach(() => {
  fired.length = 0;
});

afterEach(() => {
  resetDockerWatcher();
  setDockerServices(null);
});

describe("docker watcher", () => {
  it("subscribes each watched host as its owner and fires the trigger", async () => {
    const events = fakeEvents();
    setDockerServices(events.services);

    await reconcileDockerWatch(0, new Map([[7, "user-1"]]));
    expect(events.calls).toEqual([{ userId: "user-1", hostId: 7 }]);

    events.emit("user-1:7", { hostId: 7, container: "web", event: "exited" });
    await Promise.resolve();
    expect(fired).toEqual([
      { hostId: 7, ownerUserId: "user-1", container: "web", event: "exited" },
    ]);
  });

  it("re-subscribes once a minute and drops hosts no longer watched", async () => {
    const events = fakeEvents();
    setDockerServices(events.services);
    const watched = new Map([[7, "user-1"]]);

    await reconcileDockerWatch(1_000, watched);
    await reconcileDockerWatch(30_000, watched);
    expect(events.calls).toHaveLength(1);
    await reconcileDockerWatch(62_000, watched);
    expect(events.calls).toHaveLength(2);
    expect(events.subscriptions.get("user-1:7")?.size).toBe(1);

    await reconcileDockerWatch(63_000, new Map());
    expect(events.subscriptions.get("user-1:7")?.size).toBe(0);
  });

  it("does nothing while the docker plugin is off, then picks it up", async () => {
    setDockerServices({
      get: () => ({}),
    } as unknown as PluginServices);
    await expect(
      reconcileDockerWatch(0, new Map([[7, "user-1"]])),
    ).resolves.toBeUndefined();

    const events = fakeEvents();
    setDockerServices(events.services);
    await reconcileDockerWatch(1, new Map([[7, "user-1"]]));
    expect(events.calls).toHaveLength(1);
  });

  it("fails a docker step cleanly while the plugin is off", async () => {
    setDockerServices({ get: () => ({}) } as unknown as PluginServices);
    expect(await runDockerAction("user-1", 7, "web", "restart")).toEqual({
      ok: false,
      unavailable: true,
      error: "The docker plugin is not available",
    });
  });

  it("runs a docker step through the docker service", async () => {
    const action = vi.fn(async () => {});
    setDockerServices({
      get: (name: string) => (name === "docker.containers" ? { action } : {}),
    } as unknown as PluginServices);
    expect(await runDockerAction("user-1", 7, "web", "restart")).toEqual({
      ok: true,
    });
    expect(action).toHaveBeenCalledWith(7, "web", "restart");
  });
});
