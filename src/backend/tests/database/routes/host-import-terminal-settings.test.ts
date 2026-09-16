import { beforeEach, expect, it, vi } from "vitest";
import type { Router, RequestHandler, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
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
import { registerHostBulkRoutes } from "../../../database/routes/host-bulk-routes.js";
import { buildExportPayload } from "../../../../ui/sidebar/host-export-payload";

let handler: RequestHandler;
const router = {
  post: (path: string, ...handlers: RequestHandler[]) => {
    if (path === "/bulk-import") handler = handlers.at(-1)!;
  },
  put: () => {},
  patch: () => {},
  delete: () => {},
} as unknown as Router;
const pass: RequestHandler = (_req, _res, next) => next();
registerHostBulkRoutes(router, pass, pass, pass, pass);
const host = {
  ip: "192.0.2.1",
  port: 22,
  username: "alice",
  authType: "none",
  enableCommandHistory: false,
  enableTerminalToolbar: false,
  terminalConfig: { macOptionIsMeta: false },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 71 });
  mocks.update.mockResolvedValue({ id: 19 });
  mocks.list.mockResolvedValue([{ ...host, id: 19 }]);
});

it.each([false, true])(
  "preserves disabled terminal settings through export selection and import (overwrite=%s)",
  async (overwrite) => {
    const payload = buildExportPayload(
      { hosts: [host] },
      null,
      new Set(["featureFlags", "advanced"]),
      false,
    );
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
    expect(saved).toMatchObject({
      enableCommandHistory: false,
      enableTerminalToolbar: false,
    });
    expect(JSON.parse(saved.terminalConfig)).toEqual({
      macOptionIsMeta: false,
    });
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

it("imports forward jump references first and replaces source IDs with destination IDs", async () => {
  mocks.create
    .mockResolvedValueOnce({ id: 501 })
    .mockResolvedValueOnce({ id: 502 });
  const raw = {
    hosts: [
      { ...host, exportId: 10, jumpHosts: [{ hostId: 20 }] },
      { ...host, ip: "192.0.2.2", exportId: 20 },
    ],
  };
  const payload = buildExportPayload(raw, null, new Set(["jumpHosts"]), false);
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
});

it("maps overwritten jump hosts to their existing destination ID", async () => {
  mocks.list.mockResolvedValue([{ ...host, ip: "192.0.2.2", id: 801 }]);
  const res = await importHosts(
    [
      { ...host, exportId: 10, jumpHosts: [{ hostId: 20 }] },
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
});

it.each([
  [{ ...host, jumpHosts: [{ hostId: 20 }] }],
  [{ ...host, exportId: 10, jumpHosts: [{ hostId: 10 }] }],
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
