import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteSessions } from "../../src/backend/sessions.js";
import { createLiveSessions } from "../../src/backend/live-sessions.js";
import { GuacamoleTokenService } from "../../src/backend/token-service.js";

const meta = {
  termixConnectId: "c1",
  hostId: 7,
  hostName: "Win box",
  ownerUserId: "user-1",
  protocol: "rdp" as const,
  tabInstanceId: "tab-1",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteSessions", () => {
  it("moves parked resources onto the session and releases them on close", () => {
    const sessions = new RemoteSessions();
    const tunnel = vi.fn();
    const tracking = vi.fn();
    sessions.park("c1", [tunnel]);
    sessions.opened(meta, "g1", [tracking]);

    expect(sessions.byConnect("c1")?.guacamoleConnectionId).toBe("g1");
    expect(sessions.byGuacamole("g1")?.hostName).toBe("Win box");
    expect(tunnel).not.toHaveBeenCalled();

    sessions.closed("c1");
    expect(tunnel).toHaveBeenCalledOnce();
    expect(tracking).toHaveBeenCalledOnce();
    expect(sessions.byGuacamole("g1")).toBeNull();
  });

  it("releases a tunnel guacd never used", () => {
    vi.useFakeTimers();
    const sessions = new RemoteSessions(1000);
    const tunnel = vi.fn();
    sessions.park("c1", [tunnel]);
    vi.advanceTimersByTime(1000);
    expect(tunnel).toHaveBeenCalledOnce();
  });

  it("releases everything on clear, and one failing close does not stop the rest", () => {
    const sessions = new RemoteSessions();
    const failing = vi.fn(() => {
      throw new Error("already closed");
    });
    const pending = vi.fn();
    const open = vi.fn();
    sessions.park("c2", [failing, pending]);
    sessions.park("c1", [open]);
    sessions.opened(meta, "g1");
    sessions.clear();
    expect(pending).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });
});

describe("sessions.live providers", () => {
  const tokens = new GuacamoleTokenService();

  it("describes a live session of its own protocol only", () => {
    const sessions = new RemoteSessions();
    sessions.opened(meta, "g1");
    const deps = { sessions, tokens, endSession: vi.fn(() => true) };
    const rdp = createLiveSessions("rdp", deps);
    const vnc = createLiveSessions("vnc", deps);

    expect(rdp.getSession("g1")).toMatchObject({
      id: "g1",
      userId: "user-1",
      hostId: 7,
      hostName: "Win box",
      isConnected: true,
      tabInstanceId: "tab-1",
    });
    expect(vnc.getSession("g1")).toBeNull();
  });

  it("mints a join token for a viewer and refuses an unknown session", () => {
    const sessions = new RemoteSessions();
    sessions.opened(meta, "g1");
    const rdp = createLiveSessions("rdp", {
      sessions,
      tokens,
      endSession: vi.fn(() => true),
    });

    const token = tokens.decryptToken(rdp.createViewerToken("g1", true));
    expect(token?.connection).toMatchObject({ join: "g1", readOnly: true });
    expect(token?.recording).toBeUndefined();
    expect(() => rdp.createViewerToken("nope", false)).toThrow();
  });

  it("ends the session for its owner", () => {
    const sessions = new RemoteSessions();
    sessions.opened(meta, "g1");
    const endSession = vi.fn(() => true);
    const rdp = createLiveSessions("rdp", { sessions, tokens, endSession });
    rdp.ownerEndSession("g1", "owner ended");
    expect(endSession).toHaveBeenCalledWith("g1");
  });
});
