import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteRoutinePluginNoise = vi.fn<() => Promise<number>>();
const forceSave = vi.fn<(reason: string) => Promise<void>>();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAuditLogRepository: () => ({ deleteRoutinePluginNoise }),
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave },
}));

const { runAuditNoiseCleanup } =
  await import("../../upgrade/audit-noise-cleanup.js");

describe("runAuditNoiseCleanup", () => {
  beforeEach(() => {
    deleteRoutinePluginNoise.mockReset();
    forceSave.mockReset().mockResolvedValue();
  });

  it("saves once after removing entries", async () => {
    deleteRoutinePluginNoise.mockResolvedValue(9000);

    await expect(runAuditNoiseCleanup()).resolves.toBe(9000);
    expect(forceSave).toHaveBeenCalledOnce();
  });

  it("does not save when there was nothing to remove", async () => {
    deleteRoutinePluginNoise.mockResolvedValue(0);

    await expect(runAuditNoiseCleanup()).resolves.toBe(0);
    expect(forceSave).not.toHaveBeenCalled();
  });

  it("never fails the boot", async () => {
    deleteRoutinePluginNoise.mockRejectedValue(new Error("locked"));

    await expect(runAuditNoiseCleanup()).resolves.toBe(0);
  });
});
