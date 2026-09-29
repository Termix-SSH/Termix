import { EventEmitter } from "node:events";
import type { Express, Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileListingRoutes } from "../../src/backend/list-routes.js";
import {
  execChannel,
  getSessionSftp,
  type SSHSession,
} from "../../src/backend/session.js";
import { resolveHomeDirectory } from "../../src/backend/home-directory.js";

vi.mock("../../src/backend/session.js", () => ({
  getSessionSftp: vi.fn(),
  execChannel: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

function setup(home: string, owned = true) {
  const sftp = {
    realpath: vi.fn((_path, done) => done(null, home)),
    readdir: vi.fn((_path, done) => done(null, [])),
  };
  vi.mocked(getSessionSftp).mockResolvedValue(sftp as never);
  let handler!: (req: Request, res: Response) => Promise<unknown>;
  registerFileListingRoutes(
    {
      get: (_path, cb) => {
        handler = cb;
      },
    } as Express,
    {
      ctx: {
        currentActor: () => "user",
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as PluginContext,
      sshSessions: {
        s: { isConnected: true, activeOperations: 0 } as SSHSession,
      },
      activeListRequests: {},
      verifySessionOwnership: () => owned,
    },
  );
  const res = { on: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  return {
    sftp,
    res,
    list: (path?: string) =>
      handler(
        { query: { sessionId: "s", path } } as unknown as Request,
        res as unknown as Response,
      ),
  };
}

describe("remote login directory", () => {
  it.each(["/root", "/srv/users/alice", "/"])(
    "lists the actual SFTP directory %s",
    async (home) => {
      const { sftp, res, list } = setup(home);
      await list(".");
      await vi.waitFor(() =>
        expect(res.json).toHaveBeenCalledWith({ files: [], path: home }),
      );
      expect(sftp.realpath).toHaveBeenCalledWith(".", expect.any(Function));
      expect(sftp.readdir).toHaveBeenCalledWith(home, expect.any(Function));
      expect(execChannel).not.toHaveBeenCalled();
    },
  );
  it("preserves an explicit root instead of replacing it with home", async () => {
    const { sftp, res, list } = setup("/home/alice");
    await list("/");
    await vi.waitFor(() =>
      expect(res.json).toHaveBeenCalledWith({ files: [], path: "/" }),
    );
    expect(sftp.realpath).not.toHaveBeenCalled();
  });
  it("checks ownership before discovering the home directory", async () => {
    const { res, list } = setup("/home/alice", false);
    await list(".");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(getSessionSftp).not.toHaveBeenCalled();
  });
  it("falls back to the shell login directory when SFTP is unavailable", async () => {
    vi.mocked(getSessionSftp).mockRejectedValue(new Error("SFTP unavailable"));
    vi.mocked(execChannel).mockImplementation((_session, command, done) => {
      expect(command).toBe("pwd -P");
      const stream = new EventEmitter();
      done(undefined as never, stream as never);
      queueMicrotask(() => {
        stream.emit("data", Buffer.from("/srv/alice\n"));
        stream.emit("close", 0);
      });
    });
    await expect(resolveHomeDirectory({} as SSHSession)).resolves.toBe(
      "/srv/alice",
    );
  });
});
