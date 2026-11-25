import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  links: (async () => []) as () => Promise<unknown[]>,
  mismatches: [] as Array<Record<string, unknown>>,
  updates: [] as unknown[],
  failAt: 0,
  warn: vi.fn(),
}));

vi.mock("../../sync/client/link-store.js", () => ({
  listLinks: () => state.links(),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostDefaultsRepository: () => ({
    listSshPortMismatches: async () => state.mismatches,
    updateSshPortRow: async (row: unknown, values: unknown) => {
      if (state.updates.length + 1 === state.failAt) {
        throw new Error("connection lost");
      }
      state.updates.push({ row, values });
      // The hook the real factory gives the repository on SQLite.
      await DatabaseSaveTrigger.forceSave("host_defaults_repository_write");
      return true;
    },
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: state.warn },
}));

const { DatabaseSaveTrigger } =
  await import("../../utils/database-save-trigger.js");
const { runSshPortRepairMigration } =
  await import("../../upgrade/ssh-port-repair-migration.js");
const save = vi.fn(async () => {});

const legacy = {
  id: 1,
  port: 2222,
  sshPort: 22,
  defaultOverrides: '{"core":[]}',
  connectionType: "ssh",
  enableSsh: true,
  sharedSource: null,
};

beforeEach(() => {
  state.links = async () => [];
  state.mismatches = [{ ...legacy }];
  state.updates = [];
  state.failAt = 0;
  state.warn.mockClear();
  save.mockClear();
  DatabaseSaveTrigger.cleanup();
  DatabaseSaveTrigger.initialize(save);
});

describe("runSshPortRepairMigration", () => {
  it("repairs and saves once", async () => {
    await runSshPortRepairMigration();
    expect(state.updates).toEqual([
      {
        row: legacy,
        values: { sshPort: 2222, defaultOverrides: '{"core":["sshPort"]}' },
      },
    ]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("saves the database once for many hosts", async () => {
    state.mismatches = [1, 2, 3].map((id) => ({ ...legacy, id }));
    await runSshPortRepairMigration();
    expect(state.updates).toHaveLength(3);
    expect(save).toHaveBeenCalledOnce();
  });

  it("still saves the hosts written before a failure", async () => {
    state.mismatches = [1, 2, 3].map((id) => ({ ...legacy, id }));
    state.failAt = 2;
    await runSshPortRepairMigration();
    expect(state.updates).toHaveLength(1);
    expect(save).toHaveBeenCalledOnce();
    expect(state.warn).toHaveBeenCalledOnce();
  });

  it("does not save when nothing changed", async () => {
    state.mismatches = [];
    await runSshPortRepairMigration();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips a linked desktop, whose sync would push every repair", async () => {
    state.links = async () => [{ id: "link" }];
    await runSshPortRepairMigration();
    expect(state.updates).toEqual([]);
  });

  it("skips when it cannot tell whether a link exists", async () => {
    state.links = async () => {
      throw new Error("locked");
    };
    await runSshPortRepairMigration();
    expect(state.updates).toEqual([]);
    expect(state.warn).toHaveBeenCalledOnce();
  });

  it("never fails the boot", async () => {
    state.mismatches = null as never;
    await expect(runSshPortRepairMigration()).resolves.toBeUndefined();
    expect(state.warn).toHaveBeenCalledOnce();
  });
});
