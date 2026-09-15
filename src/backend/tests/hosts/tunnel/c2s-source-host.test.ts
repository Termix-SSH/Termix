import { describe, expect, it, vi } from "vitest";
import { resolveC2SSourceHostId } from "../../../hosts/tunnel/c2s-relay.js";

describe("resolveC2SSourceHostId", () => {
  it("uses the remote row matching the stable sync id", async () => {
    const findBySyncId = vi.fn().mockResolvedValue(42);

    await expect(
      resolveC2SSourceHostId(
        { sourceHostId: 7, sourceHostSyncId: "host-sync-id" },
        findBySyncId,
      ),
    ).resolves.toBe(42);
    expect(findBySyncId).toHaveBeenCalledWith("host-sync-id");
  });

  it("keeps legacy local ids when no sync id is available", async () => {
    await expect(
      resolveC2SSourceHostId({ sourceHostId: 7 }, vi.fn()),
    ).resolves.toBe(7);
  });

  it("does not silently fall back to a mismatched id", async () => {
    await expect(
      resolveC2SSourceHostId(
        { sourceHostId: 7, sourceHostSyncId: "missing" },
        vi.fn().mockResolvedValue(null),
      ),
    ).rejects.toThrow("not found on the remote server");
  });
});
