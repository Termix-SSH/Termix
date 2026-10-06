import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";

describe("DatabaseSaveTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
    DatabaseSaveTrigger.cleanup();
  });

  it("batches informational touches without scheduling per-session saves", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    for (let minute = 0; minute < 4; minute++) {
      DatabaseSaveTrigger.markDirty();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(save).not.toHaveBeenCalled();
    expect(DatabaseSaveTrigger.isDirty).toBe(true);
    expect(DatabaseSaveTrigger.getStatus().hasPendingTimeout).toBe(false);
    const flushed = DatabaseSaveTrigger.forceSave("periodic_flush");
    // A save yields one event-loop turn, which fake timers also control.
    await vi.runOnlyPendingTimersAsync();
    await flushed;
    expect(save).toHaveBeenCalledOnce();
    expect(DatabaseSaveTrigger.isDirty).toBe(false);
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

  it("lets the event loop turn before a force save resolves", async () => {
    DatabaseSaveTrigger.initialize(vi.fn().mockResolvedValue(undefined));
    let turned = false;
    setImmediate(() => {
      turned = true;
    });

    await DatabaseSaveTrigger.forceSave("bulk_write");

    expect(turned).toBe(true);
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
    await vi.runOnlyPendingTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.isDirty).toBe(false);
    expect(DatabaseSaveTrigger.getStatus().pendingSave).toBe(false);
  });

  it("saves at most once per 30 seconds while writes keep coming", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    // One sample every 3 seconds used to rewrite the database after each one.
    for (let tick = 0; tick < 40; tick++) {
      void DatabaseSaveTrigger.triggerSave("sample");
      await vi.advanceTimersByTimeAsync(3000);
    }
    // 120 seconds: the first save after 2s, then one per 30s window.
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(save.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("still saves a steady stream of writes", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    for (let second = 0; second < 40; second++) {
      void DatabaseSaveTrigger.triggerSave("sample");
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(save.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("saves a lone write after a quiet period within the debounce", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    void DatabaseSaveTrigger.triggerSave("first");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    void DatabaseSaveTrigger.triggerSave("later");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not let a force save be throttled", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    void DatabaseSaveTrigger.triggerSave("sample");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    // Inside the 30s window, but a critical write saves right away.
    vi.useRealTimers();
    await DatabaseSaveTrigger.forceSave("user_create");
    expect(save).toHaveBeenCalledTimes(2);
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

  it("collapses force saves inside a batch into one save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);

    const result = await DatabaseSaveTrigger.batched(async (rows: number) => {
      for (let i = 0; i < rows; i++) {
        await DatabaseSaveTrigger.forceSave("row_write");
      }
      expect(save).not.toHaveBeenCalled();
      return rows;
    })(50);

    expect(result).toBe(50);
    expect(save).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.isDirty).toBe(false);
  });

  it("folds a nested batch into the outer one", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    const inner = DatabaseSaveTrigger.batched(() =>
      DatabaseSaveTrigger.forceSave("inner_write"),
    );

    await DatabaseSaveTrigger.batched(async () => {
      await inner();
      await inner();
    })();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("skips the save when a batch wrote nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);

    await DatabaseSaveTrigger.batched(async () => {})();

    expect(save).not.toHaveBeenCalled();
  });

  it("still saves what a failed batch wrote", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);

    await expect(
      DatabaseSaveTrigger.batched(async () => {
        await DatabaseSaveTrigger.forceSave("row_write");
        throw new Error("boom");
      })(),
    ).rejects.toThrow("boom");

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves immediately for work that outlives its batch", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    DatabaseSaveTrigger.initialize(save);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached: Promise<void> | undefined;

    await DatabaseSaveTrigger.batched(async () => {
      detached = gate.then(() => DatabaseSaveTrigger.forceSave("late_write"));
    })();
    release?.();
    await detached;

    expect(save).toHaveBeenCalledTimes(1);
  });
});
