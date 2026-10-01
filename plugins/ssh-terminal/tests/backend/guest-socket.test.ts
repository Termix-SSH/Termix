/**
 * A share-link guest only ever acts as a participant. Once it has left the
 * session it can send nothing, so a read-only guest cannot "disconnect" and
 * then type into the owner's shell.
 */

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalSocket } from "../../src/backend/terminal-socket.js";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  closedWith: number | null = null;
  send(message: string) {
    this.sent.push(message);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
    this.emit("close");
  }
  ping() {}
  terminate() {
    this.close(1006);
  }
  message(type: string, data?: unknown) {
    this.emit("message", Buffer.from(JSON.stringify({ type, data })));
  }
}

function fakeSessions(permissionLevel: "read-only" | "read-write") {
  const written: string[] = [];
  const participants = new Map<
    unknown,
    { isOwner: boolean; permissionLevel: string }
  >();
  const session = {
    isConnected: true,
    sshStream: { write: (chunk: Buffer) => written.push(chunk.toString()) },
  };
  const manager = {
    getSession: (id: string) => (id === "s1" ? session : null),
    joinAsParticipant: (_id: string, ws: unknown) => {
      participants.set(ws, { isOwner: false, permissionLevel });
      return "s1";
    },
    getBuffer: () => "",
    getParticipantForWs: (_session: unknown, ws: unknown) =>
      participants.get(ws) ?? null,
    removeParticipant: (_id: string, ws: unknown) => {
      participants.delete(ws);
    },
    bufferInput: () => {},
  };
  return { manager, written };
}

function socketFor(permissionLevel: "read-only" | "read-write") {
  const sessions = fakeSessions(permissionLevel);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const terminal = createTerminalSocket({
    ctx: {} as never,
    log: log as never,
    sessionManager: sessions.manager as never,
    getTmux: () => null,
    getSharing: () => null,
    getGuests: () => ({
      resolve: async () => ({
        ok: true,
        share: { id: "share-1", sessionId: "s1", permissionLevel },
      }),
      recordJoin: async () => {},
    }),
  } as never);
  return { terminal, written: sessions.written };
}

async function joinAsGuest(terminal: ReturnType<typeof socketFor>["terminal"]) {
  const ws = new FakeSocket();
  await terminal.handleConnection({
    socket: ws,
    request: { url: "/terminal?shareToken=abc", headers: {} },
    userId: "",
    clientIp: "10.0.0.1",
    requestOrigin: "",
    isDataUnlocked: () => false,
  } as never);
  return ws;
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
});

describe("share-link guests", () => {
  it("cannot type into a read-only session", async () => {
    const { terminal, written } = socketFor("read-only");
    const ws = await joinAsGuest(terminal);
    cleanup.push(() => terminal.closeAll());
    ws.message("input", "rm -rf ~\n");
    expect(written).toEqual([]);
  });

  it("cannot type after leaving the session", async () => {
    const { terminal, written } = socketFor("read-only");
    const ws = await joinAsGuest(terminal);
    cleanup.push(() => terminal.closeAll());
    ws.message("disconnect");
    ws.message("input", "rm -rf ~\n");
    expect(written).toEqual([]);
    expect(ws.closedWith).toBe(1000);
  });

  it("a read-write guest types until it leaves", async () => {
    const { terminal, written } = socketFor("read-write");
    const ws = await joinAsGuest(terminal);
    cleanup.push(() => terminal.closeAll());
    ws.message("input", "ls\n");
    ws.message("disconnect");
    ws.message("input", "whoami\n");
    expect(written).toEqual(["ls\n"]);
  });
});
