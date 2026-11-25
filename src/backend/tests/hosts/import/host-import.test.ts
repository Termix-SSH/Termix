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

  it("matches a host without jump hosts the same way as before", async () => {
    mocks.list.mockResolvedValue([
      { id: 12, ip: "192.0.2.1", port: 22, username: "alice", jumpHosts: null },
    ]);
    const result = await runBulkImport("u1", { hosts: [good] });
    expect(result).toMatchObject({ success: 0, skipped: 1 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps hosts that share ip, port and user but jump differently", async () => {
    mocks.list.mockResolvedValue([
      {
        id: 12,
        ip: "192.0.2.11",
        port: 22,
        username: "runner",
        jumpHosts: JSON.stringify([{ hostId: 3 }]),
      },
    ]);
    mocks.create.mockReset();
    let nextId = 21;
    mocks.create.mockImplementation(async () => ({ id: nextId++ }));
    const bastion = (exportId: number, ip: string) => ({
      exportId,
      ip,
      port: 22,
      username: "ops",
      authType: "none",
    });
    const behind = (exportId: number, jumpHostId: number) => ({
      ...good,
      exportId,
      ip: "192.0.2.11",
      username: "runner",
      jumpHosts: [{ hostId: jumpHostId }],
    });
    try {
      const result = await runBulkImport("u1", {
        hosts: [
          bastion(7, "203.0.113.7"),
          bastion(8, "203.0.113.8"),
          behind(11, 7),
          behind(12, 8),
        ],
      });
      expect(result).toMatchObject({ success: 4, skipped: 0, failed: 0 });
      expect(result.createdHostIds).toEqual([21, 22, 23, 24]);
      expect(mocks.create.mock.calls[2][1].jumpHosts).toBe(
        JSON.stringify([{ hostId: 21 }]),
      );
      expect(mocks.create.mock.calls[3][1].jumpHosts).toBe(
        JSON.stringify([{ hostId: 22 }]),
      );
    } finally {
      mocks.create.mockReset();
    }
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
