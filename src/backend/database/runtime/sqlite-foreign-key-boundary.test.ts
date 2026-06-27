import { describe, expect, it, vi } from "vitest";
import { withSqliteForeignKeysDisabled } from "./sqlite-foreign-key-boundary.js";

describe("withSqliteForeignKeysDisabled", () => {
  it("disables foreign keys for an operation and restores them afterwards", async () => {
    const exec = vi.fn();

    await expect(
      withSqliteForeignKeysDisabled({ exec }, async () => "done"),
    ).resolves.toBe("done");

    expect(exec).toHaveBeenNthCalledWith(1, "PRAGMA foreign_keys = OFF");
    expect(exec).toHaveBeenNthCalledWith(2, "PRAGMA foreign_keys = ON");
  });

  it("restores foreign keys when the operation fails", async () => {
    const exec = vi.fn();

    await expect(
      withSqliteForeignKeysDisabled({ exec }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(exec).toHaveBeenNthCalledWith(1, "PRAGMA foreign_keys = OFF");
    expect(exec).toHaveBeenNthCalledWith(2, "PRAGMA foreign_keys = ON");
  });
});
