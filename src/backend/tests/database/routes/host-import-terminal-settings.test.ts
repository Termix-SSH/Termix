import { beforeEach, expect, it, vi } from "vitest";
import type { RequestHandler, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  applyPluginSettings: vi.fn(),
  applyDefaults: vi.fn(async () => {}),
}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  applyPluginHostImportSettings: mocks.applyPluginSettings,
  setHostPluginEnabled: vi.fn(),
}));
vi.mock("../../../hosts/defaults/index.js", () => ({
  applyHostDefaultsToWrite: async () => ({ core: [] }),
  applyDefaultsAfterHostWrite: async () => {},
  applyDefaultsAfterHostWrites: mocks.applyDefaults,
}));
vi.mock("../../../hosts/defaults/overrides.js", () => ({
  changeHostOverrides: async () => {},
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostDefaultsRepository: () => ({
    listHosts: async () => [],
  }),
  createCurrentCredentialRepository: () => ({
    listDecryptedByUserId: async () => [],
  }),
  createCurrentHostRepository: () => ({
    createEncryptedForUser: mocks.create,
    updateEncryptedForUser: mocks.update,
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostsByUserId: mocks.list,
  }),
}));
import {
  ImportError,
  importResponse,
  runBulkImport,
  runSshConfigImport,
} from "../../../hosts/import/host-import.js";
import { pluginEvents, TOPICS } from "../../../plugins/events.js";

// The same wrapping the plugin's routes give the shared import code.
const wrap =
  (run: typeof runBulkImport): RequestHandler =>
  async (req, res) => {
    try {
      const body = (req as unknown as { body: never }).body;
      res.json(
        importResponse(
          await run((req as unknown as { userId: string }).userId, body),
        ),
      );
    } catch (error) {
      if (error instanceof ImportError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  };
const handler = wrap(runBulkImport);
const sshConfigHandler = wrap(runSshConfigImport as typeof runBulkImport);
const host = {
  ip: "192.0.2.1",
  port: 22,
  username: "alice",
  authType: "none",
  pluginSettings: {
    "ssh-terminal": {
      enableCommandHistory: false,
      enableTerminalToolbar: false,
    },
  },
  terminalConfig: { macOptionIsMeta: false },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 71 });
  mocks.update.mockResolvedValue({ id: 19 });
  mocks.list.mockResolvedValue([]);
});

it.each([false, true])(
  "carries plugin host settings through export selection and import (overwrite=%s)",
  async (overwrite) => {
    if (overwrite) mocks.list.mockResolvedValue([{ ...host, id: 19 }]);
    const payload = { hosts: [host] };
    expect(payload.hosts[0]).toMatchObject(host);
    const json = vi.fn();
    await handler(
      {
        userId: "user-1",
        body: { ...payload, overwrite },
      } as unknown as Request,
      { json } as unknown as Response,
      vi.fn(),
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ failed: 0 }));
    const write = overwrite ? mocks.update : mocks.create;
    expect(write).toHaveBeenCalledTimes(1);
    const saved = write.mock.calls[0].at(-1);
    expect(mocks.applyPluginSettings).toHaveBeenCalledWith(
      overwrite ? 19 : 71,
      expect.objectContaining({ pluginSettings: host.pluginSettings }),
    );
    // The 2.8 terminalConfig reaches the plugin, never a host column.
    expect(saved).not.toHaveProperty("terminalConfig");
  },
);

async function importHosts(
  hosts: Record<string, unknown>[],
  overwrite = false,
) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  await handler(
    { userId: "user-1", body: { hosts, overwrite } } as unknown as Request,
    res as unknown as Response,
    vi.fn(),
  );
  return res;
}

it.each([20, "20"])(
  "imports forward jump reference %j and replaces source IDs with destination IDs",
  async (jumpId) => {
    mocks.create
      .mockResolvedValueOnce({ id: 501 })
      .mockResolvedValueOnce({ id: 502 });
    const raw = {
      hosts: [
        { ...host, exportId: 10, jumpHosts: [{ hostId: jumpId }] },
        { ...host, ip: "192.0.2.2", exportId: 20 },
      ],
    };
    const payload = raw;
    const res = await importHosts(payload.hosts);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: 2, failed: 0 }),
    );
    expect(mocks.create.mock.calls[0][1].ip).toBe("192.0.2.2");
    expect(JSON.parse(mocks.create.mock.calls[1][1].jumpHosts)).toEqual([
      { hostId: 501 },
    ]);
    expect(mocks.create.mock.calls[1][1]).not.toHaveProperty("exportId");
    expect(mocks.create.mock.calls[1][1]).not.toHaveProperty("id");
    // One defaults pass for the whole import, not one per host.
    expect(mocks.applyDefaults).toHaveBeenCalledTimes(1);
    expect(mocks.applyDefaults).toHaveBeenCalledWith([501, 502]);
  },
);

it.each([20, "20"])(
  "maps overwritten jump reference %j to its existing destination ID",
  async (jumpId) => {
    mocks.list.mockResolvedValue([{ ...host, ip: "192.0.2.2", id: 801 }]);
    const res = await importHosts(
      [
        { ...host, exportId: 10, jumpHosts: [{ hostId: jumpId }] },
        { ...host, ip: "192.0.2.2", exportId: 20 },
      ],
      true,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: 1, updated: 1, failed: 0 }),
    );
    expect(JSON.parse(mocks.create.mock.calls[0][1].jumpHosts)).toEqual([
      { hostId: 801 },
    ]);
  },
);

it("skips hosts that already exist when not overwriting", async () => {
  mocks.list.mockResolvedValue([{ ...host, id: 19 }]);
  const res = await importHosts([host]);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: 0, updated: 0, skipped: 1, failed: 0 }),
  );
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.applyPluginSettings).not.toHaveBeenCalled();
});

it("maps a skipped jump host reference to its existing destination ID", async () => {
  mocks.list.mockResolvedValue([{ ...host, ip: "192.0.2.2", id: 801 }]);
  const res = await importHosts([
    { ...host, exportId: 10, jumpHosts: [{ hostId: 20 }] },
    { ...host, ip: "192.0.2.2", exportId: 20 },
  ]);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: 1, skipped: 1, failed: 0 }),
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(JSON.parse(mocks.create.mock.calls[0][1].jumpHosts)).toEqual([
    { hostId: 801 },
  ]);
});

it.each([
  [false, { success: 0, updated: 0, skipped: 1 }],
  [true, { success: 0, updated: 1, skipped: 0 }],
])(
  "SSH config import with an existing host (overwrite=%s)",
  async (overwrite, counts) => {
    mocks.list.mockResolvedValue([{ ...host, id: 19 }]);
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await sshConfigHandler(
      {
        userId: "user-1",
        body: {
          content: "Host web\n  HostName 192.0.2.1\n  User alice\n  Port 22\n",
          overwrite,
        },
      } as unknown as Request,
      res as unknown as Response,
      vi.fn(),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ...counts, failed: 0 }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(overwrite ? 1 : 0);
  },
);

it.each([
  [{ ...host, jumpHosts: [{ hostId: 20 }] }],
  [{ ...host, jumpHosts: [{ hostId: "20" }] }],
  [{ ...host, exportId: 10, jumpHosts: [{ hostId: 10 }] }],
  [{ ...host, exportId: 10, jumpHosts: [{ hostId: "10" }] }],
  [
    { ...host, exportId: 10, jumpHosts: [{ hostId: "20oops" }] },
    { ...host, exportId: 20 },
  ],
  [
    { ...host, exportId: 10 },
    { ...host, exportId: 10 },
  ],
])(
  "rejects missing, cyclic, and ambiguous jump references before writing",
  async (...hosts) => {
    const res = await importHosts(hosts);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  },
);

it("does not save dependent hosts when importing their jump host fails", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Write failed"));
  const res = await importHosts([
    { ...host, exportId: 10, jumpHosts: [{ hostId: 20 }] },
    { ...host, ip: "192.0.2.2", exportId: 20 },
  ]);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ failed: 2, success: 0 }),
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

function collectCreated() {
  const seen: unknown[] = [];
  const off = pluginEvents.on(TOPICS.hostCreated, (payload) => {
    seen.push(payload);
  });
  return { seen, off };
}

it("publishes host.created once for each host a JSON import creates", async () => {
  mocks.list.mockResolvedValue([{ ...host, id: 19 }]);
  mocks.create.mockResolvedValueOnce({ id: 501 });
  const { seen, off } = collectCreated();
  try {
    await importHosts([host, { ...host, ip: "192.0.2.2" }], true);
  } finally {
    off();
  }
  // The overwritten host already existed, so only the new one is announced.
  expect(seen).toEqual([{ hostId: 501, userId: "user-1" }]);
});

it("publishes host.created once for each host an SSH config import creates", async () => {
  mocks.create
    .mockResolvedValueOnce({ id: 601 })
    .mockResolvedValueOnce({ id: 602 });
  const { seen, off } = collectCreated();
  try {
    await sshConfigHandler(
      {
        userId: "user-1",
        body: {
          content:
            "Host a\n  HostName 10.0.0.1\n  User root\nHost b\n  HostName 10.0.0.2\n  User root\n",
        },
      } as unknown as Request,
      {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response,
      vi.fn(),
    );
  } finally {
    off();
  }
  expect(seen).toEqual([
    { hostId: 601, userId: "user-1" },
    { hostId: 602, userId: "user-1" },
  ]);
});
