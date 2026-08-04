import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";

describe("DatabaseSaveTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
    DatabaseSaveTrigger.cleanup();
  });

  it("force saves through the initialized save function", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);

    await DatabaseSaveTrigger.forceSave("test_force_save");

    expect(save).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.getStatus()).toMatchObject({
      initialized: true,
      pendingSave: false,
      hasPendingTimeout: false,
    });
  });

  it("debounces dirty saves and marks the database clean after saving", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);

    await DatabaseSaveTrigger.triggerSave("first");
    await DatabaseSaveTrigger.triggerSave("second");

    expect(DatabaseSaveTrigger.isDirty).toBe(true);
    expect(DatabaseSaveTrigger.getStatus().hasPendingTimeout).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.isDirty).toBe(false);
    expect(DatabaseSaveTrigger.getStatus().pendingSave).toBe(false);
  });

  it("queues a force save behind an in-flight save", async () => {
    let finishFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      finishFirstSave = resolve;
    });
    const save = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);
    DatabaseSaveTrigger.initialize(save);

    const first = DatabaseSaveTrigger.forceSave("first_write");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const second = DatabaseSaveTrigger.forceSave("sso_provider_write");
    expect(save).toHaveBeenCalledTimes(1);

    finishFirstSave?.();
    await Promise.all([first, second]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(DatabaseSaveTrigger.getStatus().pendingSave).toBe(false);
  });
});
