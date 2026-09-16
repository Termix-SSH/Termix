import { beforeEach, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import type { SSHSession } from "../../../hosts/file-manager/session.js";

const mocks = vi.hoisted(() => ({
  getSessionSftp: vi.fn(),
  execChannel: vi.fn(),
}));
vi.mock("../../../hosts/file-manager/session.js", () => ({
  ...mocks,
  execWithSudo: vi.fn(),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({}) },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: vi.fn(),
  getCurrentSettingValue: vi.fn(),
}));
import { registerFileOperationRoutes } from "../../../hosts/file-manager/operation-routes.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;
function setup(owned = true) {
  const routes = new Map<string, Handler>();
  const app = {
    get: vi.fn(),
    put: vi.fn(),
    post: (url: string, fn: Handler) => routes.set(url, fn),
    delete: vi.fn(),
  } as unknown as Express;
  registerFileOperationRoutes(app, {
    sshSessions: { test: { isConnected: true } as SSHSession },
    verifySessionOwnership: () => owned,
  });
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = {
    userId: "owner",
    body: { sessionId: "test", path: "/tmp", folderName: "parent/child" },
  } as unknown as Request;
  return {
    run: () =>
      routes.get("/ssh/file_manager/ssh/createFolder")!(
        req,
        res as unknown as Response,
      ),
    res,
  };
}
beforeEach(() => vi.clearAllMocks());
it("creates nested folders over SFTP when the server cannot execute shell commands", async () => {
  const mkdir = vi.fn((path, _attrs, cb) =>
    cb(path === "/tmp" ? { code: 4 } : null),
  );
  mocks.getSessionSftp.mockResolvedValue({
    mkdir,
    stat: (
      _path: string,
      cb: (error: unknown, stats?: { isDirectory: () => boolean }) => void,
    ) => cb(null, { isDirectory: () => true }),
  });
  const { run, res } = setup();
  await run();
  expect(mkdir.mock.calls.map((call) => call[0])).toEqual([
    "/tmp",
    "/tmp/parent",
    "/tmp/parent/child",
  ]);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ path: "/tmp/parent/child" }),
  );
  expect(mocks.execChannel).not.toHaveBeenCalled();
});
it("reports permission denial instead of success", async () => {
  const error = Object.assign(new Error("Permission denied"), { code: 3 });
  mocks.getSessionSftp.mockResolvedValue({
    mkdir: (
      _p: string,
      _a: unknown,
      cb: (error: unknown, stats?: { isDirectory: () => boolean }) => void,
    ) => cb(error),
    stat: (
      _p: string,
      cb: (error: unknown, stats?: { isDirectory: () => boolean }) => void,
    ) => cb(error),
  });
  const { run, res } = setup();
  await run();
  expect(res.status).toHaveBeenCalledWith(403);
});
it("rejects a session belonging to another user before opening SFTP", async () => {
  const { run, res } = setup(false);
  await run();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mocks.getSessionSftp).not.toHaveBeenCalled();
});
