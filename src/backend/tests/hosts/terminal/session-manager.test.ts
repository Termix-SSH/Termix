import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub all external imports before loading the module under test
const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
const mockUpdateEnded = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => ({}),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSessionRecordingRepository: () => ({
    create: mockCreate,
    updateEnded: mockUpdateEnded,
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock individual fs.promises methods via a stub object
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockAppendFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      appendFile: mockAppendFile,
      readFile: vi.fn(),
      unlink: mockUnlink,
    },
  },
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    appendFile: mockAppendFile,
    readFile: vi.fn(),
    unlink: mockUnlink,
  },
}));

const { sessionManager, isMessageAllowedForParticipant } =
  await import("../../../hosts/terminal/session-manager.js");

// Minimal fake WebSocket - only the surface session-manager touches.
function makeFakeWs(readyState = 1 /* OPEN */) {
  return {
    readyState,
    send: vi.fn(),
  } as unknown as import("ws").WebSocket;
}
const WS_OPEN = 1;
const WS_CLOSED = 3;

describe("TerminalSessionManager - session logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply resolved values after clearAllMocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdateEnded.mockResolvedValue(undefined);
  });

  it("createSession stores sessionLoggingEnabled=true by default", () => {
    const id = sessionManager.createSession("u1", 1, "host", 80, 24);
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(true);
    sessionManager.destroySession(id);
  });

  it("createSession stores sessionLoggingEnabled=false when passed", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(false);
    sessionManager.destroySession(id);
  });

  it("does not write log file when sessionLoggingEnabled=false", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    sessionManager.bufferOutput(id, "some output");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writes log file and inserts DB row when sessionLoggingEnabled=true", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.bufferOutput(id, "terminal output data");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("does not write log file when buffer is empty", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("bufferOutput trims old data when exceeding 512KB", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const chunk = "x".repeat(300 * 1024);
    sessionManager.bufferOutput(id, chunk);
    sessionManager.bufferOutput(id, chunk);
    const session = sessionManager.getSession(id);
    expect(session!.outputBufferBytes).toBeLessThanOrEqual(512 * 1024);
    sessionManager.destroySession(id);
  });
});

describe("TerminalSessionManager - multiplayer participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdateEnded.mockResolvedValue(undefined);
  });

  function createConnectedSession(): string {
    const id = sessionManager.createSession(
      "owner-1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    // Mark connected without a real ssh2 stream - only isConnected is read
    // by attachWs/joinAsParticipant.
    const session = sessionManager.getSession(id)!;
    session.isConnected = true;
    return id;
  }

  it("joinAsParticipant adds a participant without evicting the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    const session = sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-only",
      guestLabel: "Guest",
    });

    expect(session).not.toBeNull();
    expect(session!.participants.size).toBe(2);
    const ownerParticipant = sessionManager.getParticipantForWs(
      session!,
      ownerWs,
    );
    expect(ownerParticipant?.isOwner).toBe(true);
    expect(ownerWs.send).not.toHaveBeenCalled();

    sessionManager.destroySession(id);
  });

  it("joinAsParticipant returns null for a nonexistent or unconnected session", () => {
    expect(
      sessionManager.joinAsParticipant("does-not-exist", makeFakeWs(), {
        userId: null,
        permissionLevel: "read-only",
      }),
    ).toBeNull();
  });

  it("broadcast sends to all OPEN participant sockets and skips CLOSED ones", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs(WS_OPEN);
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const openGuestWs = makeFakeWs(WS_OPEN);
    const closedGuestWs = makeFakeWs(WS_CLOSED);
    sessionManager.joinAsParticipant(id, openGuestWs, {
      userId: null,
      permissionLevel: "read-only",
    });
    sessionManager.joinAsParticipant(id, closedGuestWs, {
      userId: null,
      permissionLevel: "read-only",
    });

    sessionManager.broadcast(id, { type: "data", data: "hello" });

    expect(ownerWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "data", data: "hello" }),
    );
    expect(openGuestWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "data", data: "hello" }),
    );
    expect(closedGuestWs.send).not.toHaveBeenCalled();

    sessionManager.destroySession(id);
  });

  it("broadcast does not throw if a socket's send throws", () => {
    const id = createConnectedSession();
    const throwingWs = makeFakeWs(WS_OPEN);
    (throwingWs.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("send failed");
    });
    sessionManager.attachWs(id, "owner-1", throwingWs);

    expect(() =>
      sessionManager.broadcast(id, { type: "data", data: "x" }),
    ).not.toThrow();

    sessionManager.destroySession(id);
  });

  it("broadcast is a no-op for a nonexistent session", () => {
    expect(() =>
      sessionManager.broadcast("does-not-exist", { type: "data" }),
    ).not.toThrow();
  });

  it("owner detach arms the idle timeout (existing behavior)", () => {
    vi.useFakeTimers();
    try {
      const id = createConnectedSession();
      const ownerWs = makeFakeWs();
      sessionManager.attachWs(id, "owner-1", ownerWs);

      sessionManager.detachWs(id);
      const session = sessionManager.getSession(id);
      expect(session?.detachTimeout).not.toBeNull();
      expect(session?.lastDetachedAt).not.toBeNull();

      sessionManager.destroySession(id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeParticipant on a non-owner does not arm a timeout or destroy the session", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-write",
    });

    sessionManager.removeParticipant(id, guestWs);

    const session = sessionManager.getSession(id);
    expect(session).not.toBeNull();
    expect(session?.detachTimeout).toBeNull();
    expect(session?.participants.size).toBe(1);
    expect(sessionManager.getParticipantForWs(session!, guestWs)).toBeNull();

    sessionManager.destroySession(id);
  });

  it("removeParticipant is a no-op when the ws belongs to the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    sessionManager.removeParticipant(id, ownerWs);

    const session = sessionManager.getSession(id);
    expect(session?.participants.size).toBe(1);
    expect(sessionManager.getParticipantForWs(session!, ownerWs)?.isOwner).toBe(
      true,
    );

    sessionManager.destroySession(id);
  });

  it("destroySession cleans up all participants, not just the owner", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-only",
    });

    sessionManager.destroySession(id);

    expect(guestWs.send).toHaveBeenCalled();
    expect(sessionManager.getSession(id)).toBeNull();
  });

  it("ownerEndSession notifies non-owner participants and destroys the session", () => {
    const id = createConnectedSession();
    const ownerWs = makeFakeWs();
    sessionManager.attachWs(id, "owner-1", ownerWs);

    const guestWs = makeFakeWs();
    sessionManager.joinAsParticipant(id, guestWs, {
      userId: null,
      permissionLevel: "read-write",
    });

    sessionManager.ownerEndSession(id, "owner ended the session");

    expect(guestWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "sessionTerminatedByOwner",
        reason: "owner ended the session",
      }),
    );
    expect(sessionManager.getSession(id)).toBeNull();
  });
});

describe("isMessageAllowedForParticipant", () => {
  it("allows any message type for the owner or when there is no participant", () => {
    expect(isMessageAllowedForParticipant(null, "connectToHost")).toBe(true);
    expect(
      isMessageAllowedForParticipant(
        { isOwner: true, permissionLevel: "read-write" },
        "resize",
      ),
    ).toBe(true);
  });

  it("drops input from a read-only participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "input",
      ),
    ).toBe(false);
  });

  it("allows input from a read-write non-owner participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-write" },
        "input",
      ),
    ).toBe(true);
  });

  it("allows ping and disconnect for any non-owner participant", () => {
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "ping",
      ),
    ).toBe(true);
    expect(
      isMessageAllowedForParticipant(
        { isOwner: false, permissionLevel: "read-only" },
        "disconnect",
      ),
    ).toBe(true);
  });

  it("blocks resize and auth/tmux message types for non-owner participants regardless of permission level", () => {
    for (const type of [
      "resize",
      "totp_response",
      "password_response",
      "tmux_attach",
      "tmux_detach",
      "get_cwd",
      "vault_start_auth",
      "opkssh_start_auth",
    ]) {
      expect(
        isMessageAllowedForParticipant(
          { isOwner: false, permissionLevel: "read-write" },
          type,
        ),
      ).toBe(false);
    }
  });
});
