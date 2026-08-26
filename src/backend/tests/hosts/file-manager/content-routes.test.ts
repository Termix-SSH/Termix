import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import type { SSHSession } from "../../../hosts/file-manager/session.js";

const commandMocks = vi.hoisted(() => ({
  execBuffer: vi.fn(),
  execWithSudoBuffer: vi.fn(),
}));

vi.mock("../../../hosts/file-manager/session.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../hosts/file-manager/session.js")
  >()),
  execBuffer: commandMocks.execBuffer,
  execWithSudoBuffer: commandMocks.execWithSudoBuffer,
}));

import { registerFileContentRoutes } from "../../../hosts/file-manager/content-routes.js";

type RouteHandler = (request: Request, response: Response) => Promise<unknown>;

function setupReadRoute() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => routes.set(path, handler),
    post: vi.fn(),
  } as unknown as Express;
  const session = {
    isConnected: true,
    lastActive: 0,
    sudoPassword: "sudo-secret",
  } as SSHSession;

  registerFileContentRoutes(app, {
    sshSessions: { session: session },
    verifySessionOwnership: () => true,
  });

  const handler = routes.get("/ssh/file_manager/ssh/readFile");
  if (!handler) throw new Error("readFile route was not registered");

  const request = {
    query: { sessionId: "session", path: "/root/secret.txt" },
    userId: "user",
  } as unknown as Request;
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  vi.mocked(response.status).mockReturnValue(response);
  vi.mocked(response.json).mockReturnValue(response);

  return { handler, request, response, session };
}

describe("file manager readFile", () => {
  beforeEach(() => {
    commandMocks.execBuffer.mockReset();
    commandMocks.execWithSudoBuffer.mockReset();
  });

  it("falls back to sudo for both the size check and content read", async () => {
    const { handler, request, response, session } = setupReadRoute();
    commandMocks.execBuffer
      .mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: "Permission denied",
        code: 1,
      })
      .mockResolvedValueOnce({
        stdout: Buffer.alloc(0),
        stderr: "Permission denied",
        code: 1,
      });
    commandMocks.execWithSudoBuffer
      .mockResolvedValueOnce({
        stdout: Buffer.from("6\n"),
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: Buffer.from("secret"),
        stderr: "",
        code: 0,
      });

    await handler(request, response);

    expect(commandMocks.execWithSudoBuffer).toHaveBeenNthCalledWith(
      1,
      session,
      "stat -c%s '/root/secret.txt'",
      "sudo-secret",
    );
    expect(commandMocks.execWithSudoBuffer).toHaveBeenNthCalledWith(
      2,
      session,
      "cat '/root/secret.txt'",
      "sudo-secret",
    );
    expect(response.json).toHaveBeenCalledWith({
      content: "secret",
      path: "/root/secret.txt",
      encoding: "utf8",
    });
  });

  it("keeps readable files on the unprivileged path", async () => {
    const { handler, request, response } = setupReadRoute();
    commandMocks.execBuffer
      .mockResolvedValueOnce({
        stdout: Buffer.from("5\n"),
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: Buffer.from("hello"),
        stderr: "",
        code: 0,
      });

    await handler(request, response);

    expect(commandMocks.execWithSudoBuffer).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      content: "hello",
      path: "/root/secret.txt",
      encoding: "utf8",
    });
  });

  it("rejects oversized sudo-only files before reading their content", async () => {
    const { handler, request, response } = setupReadRoute();
    commandMocks.execBuffer.mockResolvedValueOnce({
      stdout: Buffer.alloc(0),
      stderr: "Permission denied",
      code: 1,
    });
    commandMocks.execWithSudoBuffer.mockResolvedValueOnce({
      stdout: Buffer.from(String(501 * 1024 * 1024)),
      stderr: "",
      code: 0,
    });

    await handler(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ tooLarge: true }),
    );
    expect(commandMocks.execBuffer).toHaveBeenCalledTimes(1);
    expect(commandMocks.execWithSudoBuffer).toHaveBeenCalledTimes(1);
  });
});
