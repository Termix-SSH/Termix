/**
 * dispatchLoginEvent used to POST to the metrics service on localhost:30005
 * with an internal auth token. Host metrics is a plugin now and has no port,
 * so it publishes on the plugin event bus and the plugin subscribes.
 *
 * What is asserted changed with it: the payload a subscriber receives, and
 * that a throwing subscriber cannot fail the login that caused the event.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchLoginEvent } from "../../utils/login-event-dispatch.js";
import { pluginEvents, TOPICS } from "../../plugins/events.js";
import { sshLogger } from "../../utils/logger.js";

describe("dispatchLoginEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes the login details a subscriber needs", async () => {
    const received: unknown[] = [];
    const unsubscribe = pluginEvents.on(TOPICS.hostLogin, (payload) => {
      received.push(payload);
    });

    try {
      await dispatchLoginEvent(42, "user-1", "root", "10.0.0.5");
    } finally {
      unsubscribe();
    }

    expect(received).toEqual([
      { hostId: 42, userId: "user-1", sshUser: "root", fromIp: "10.0.0.5" },
    ]);
  });

  it("does not log a warning on the happy path", async () => {
    const warn = vi.spyOn(sshLogger, "warn").mockImplementation(() => {});

    await dispatchLoginEvent(7, "user-1", "root", "192.0.2.1");

    expect(warn).not.toHaveBeenCalled();
  });

  it("never sends the event over the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await dispatchLoginEvent(7, "user-1", "root", "192.0.2.1");

    // The whole point of the move: no service-to-service HTTP call, and no
    // internal shared secret to carry on it.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not propagate a subscriber's throw to the caller", async () => {
    const unsubscribe = pluginEvents.on(TOPICS.hostLogin, () => {
      throw new Error("subscriber exploded");
    });

    try {
      await expect(
        dispatchLoginEvent(1, "user-1", "root", "127.0.0.1"),
      ).resolves.toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
});
