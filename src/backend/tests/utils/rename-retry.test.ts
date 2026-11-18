import { describe, expect, it, vi } from "vitest";
import { renameWithRetry } from "../../utils/rename-retry.js";

const locked = (code: string) =>
  Object.assign(new Error(`${code}: operation not permitted`), { code });

describe("renameWithRetry", () => {
  it("tries again while Windows holds the file", async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(locked("EPERM"))
      .mockRejectedValueOnce(locked("EBUSY"))
      .mockResolvedValueOnce(undefined);
    await renameWithRetry("a", "b", { delayMs: 1 }, rename);
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last attempt", async () => {
    const rename = vi.fn().mockRejectedValue(locked("EPERM"));
    await expect(
      renameWithRetry("a", "b", { attempts: 3, delayMs: 1 }, rename),
    ).rejects.toThrow("EPERM");
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("fails at once on other errors", async () => {
    const rename = vi.fn().mockRejectedValue(locked("ENOENT"));
    await expect(
      renameWithRetry("a", "b", { delayMs: 1 }, rename),
    ).rejects.toThrow("ENOENT");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
