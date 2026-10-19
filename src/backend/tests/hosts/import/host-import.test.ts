import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  applyDefaults: vi.fn(async () => {}),
}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  applyPluginHostImportSettings: vi.fn(),
  setHostPluginEnabled: vi.fn(),
}));
vi.mock("../../../hosts/defaults/index.js", () => ({
  applyHostDefaultsToWrite: async () => ({ core: [] }),
  applyDefaultsAfterHostWrite: async () => {},
  applyDefaultsAfterHostWrites: mocks.applyDefaults,
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostDefaultsRepository: () => ({ listHosts: async () => [] }),
  createCurrentCredentialRepository: () => ({
    listDecryptedByUserId: async () => [],
  }),
  createCurrentHostRepository: () => ({
    createEncryptedForUser: mocks.create,
    updateEncryptedForUser: mocks.update,
    deleteForUser: mocks.remove,
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostsByUserId: mocks.list,
  }),
}));

import {
  ImportError,
  runBulkImport,
  runSshConfigImport,
} from "../../../hosts/import/host-import.js";
import { pluginEvents, TOPICS } from "../../../plugins/events.js";

const good = {
  ip: "192.0.2.1",
  port: 22,
  username: "alice",
  authType: "none",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.remove.mockResolvedValue({ syncId: null });
});

describe("runBulkImport", () => {
  it("creates hosts, returns their ids and tells listeners", async () => {
    mocks.create.mockResolvedValueOnce({ id: 11 });
    const created: unknown[] = [];
    const off = pluginEvents.on(TOPICS.hostCreated, (p) => created.push(p));
    try {
      const result = await runBulkImport("u1", { hosts: [good] });
      expect(result).toMatchObject({ success: 1, failed: 0 });
      expect(result.createdHostIds).toEqual([11]);
      expect(mocks.applyDefaults).toHaveBeenCalledWith([11]);
    } finally {
      off();
    }
    expect(created).toEqual([{ hostId: 11, userId: "u1" }]);
  });

  it("refuses an empty list and more than 100 hosts", async () => {
    await expect(runBulkImport("u1", { hosts: [] })).rejects.toBeInstanceOf(
      ImportError,
    );
    await expect(
      runBulkImport("u1", {
        hosts: Array.from({ length: 101 }, () => ({ ...good })),
      }),
    ).rejects.toThrow(/Maximum 100/);
  });

  it("keeps the rows that worked when atomic is off", async () => {
    mocks.create.mockResolvedValueOnce({ id: 11 });
    const result = await runBulkImport("u1", {
      hosts: [good, { ...good, ip: "" }],
    });
    expect(result).toMatchObject({ success: 1, failed: 1 });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("deletes what it created and stays quiet when atomic and a row fails", async () => {
    mocks.create
      .mockResolvedValueOnce({ id: 11 })
      .mockResolvedValueOnce({ id: 12 });
    const events: unknown[] = [];
    const off = pluginEvents.on(TOPICS.hostCreated, (p) => events.push(p));
    try {
      const result = await runBulkImport("u1", {
        hosts: [good, { ...good, ip: "192.0.2.2" }, { ...good, ip: "" }],
        atomic: true,
      });
      expect(result.rolledBack).toBe(true);
      expect(result.success).toBe(0);
      expect(result.createdHostIds).toEqual([]);
      expect(result.failed).toBe(1);
    } finally {
      off();
    }
    expect(mocks.remove.mock.calls.map((call) => call[1])).toEqual([12, 11]);
    expect(mocks.applyDefaults).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("refuses overwrite together with atomic", async () => {
    await expect(
      runBulkImport("u1", { hosts: [good], overwrite: true, atomic: true }),
    ).rejects.toThrow(/cannot overwrite/);
  });
});

describe("runSshConfigImport", () => {
  const config = "Host web\n  HostName 192.0.2.9\n  User bob\n";

  it("imports Host blocks", async () => {
    mocks.create.mockResolvedValueOnce({ id: 31 });
    const result = await runSshConfigImport("u1", { content: config });
    expect(result).toMatchObject({ success: 1, createdHostIds: [31] });
  });

  it("rejects empty content", async () => {
    await expect(
      runSshConfigImport("u1", { content: "  " }),
    ).rejects.toBeInstanceOf(ImportError);
  });
});
