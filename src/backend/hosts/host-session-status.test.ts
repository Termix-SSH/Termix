import { describe, expect, it, vi } from "vitest";
import { HostSessionStatus } from "./host-session-status.js";

describe("HostSessionStatus", () => {
  it("reports only the first connection and last disconnection per host", () => {
    const status = new HostSessionStatus();
    const listener = vi.fn();
    status.subscribe(listener);

    const closeFirst = status.register(7);
    const closeSecond = status.register(7);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(7, true);

    closeFirst();
    expect(listener).toHaveBeenCalledTimes(1);

    closeSecond();
    expect(listener).toHaveBeenLastCalledWith(7, false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("makes connection cleanup idempotent", () => {
    const status = new HostSessionStatus();
    const listener = vi.fn();
    status.subscribe(listener);

    const close = status.register(9);
    close();
    close();

    expect(listener.mock.calls).toEqual([
      [9, true],
      [9, false],
    ]);
  });
});
