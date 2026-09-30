import { describe, expect, it, vi } from "vitest";
import { createPollQueue } from "../../src/frontend/poll-queue";

describe("background host polling queue", () => {
  it("bounds concurrent hosts and releases a slot after failure", async () => {
    const run = createPollQueue(2);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = run(() => held);
    const second = run(async () => {
      throw new Error("offline");
    });
    const thirdTask = vi.fn(async () => "third");
    const third = run(thirdTask);
    expect(thirdTask).not.toHaveBeenCalled();
    await expect(second).rejects.toThrow("offline");
    await expect(third).resolves.toBe("third");
    expect(thirdTask).toHaveBeenCalledOnce();
    release();
    await first;
  });
});
