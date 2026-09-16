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
