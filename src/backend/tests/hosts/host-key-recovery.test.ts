import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier.js";
import { pluginEvents, TOPICS } from "../../plugins/events.js";

const { updateHostKey } = vi.hoisted(() => ({ updateHostKey: vi.fn() }));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({ updateHostKey }),
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const hostId = 991267;
const accepted: unknown[] = [];
const unsubscribe = pluginEvents.on(TOPICS.hostKeyUpdated, (payload) =>
  accepted.push(payload),
);
afterEach(() => {
  accepted.length = 0;
  vi.resetAllMocks();
});
afterAll(() => unsubscribe());

async function verifyChangedKey(action: "accept" | "reject") {
  const socket = new EventEmitter() as EventEmitter & {
    send: (data: string) => void;
  };
  socket.send = () => {
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "host_key_verification_response",
          data: { action },
        }),
      ),
    );
  };
  const verifier = await SSHHostKeyVerifier.createHostVerifier(
    hostId,
    "127.0.0.1",
    22,
    socket as unknown as WebSocket,
    "user",
    false,
    {
      hostKeyFingerprint: "old",
      hostKeyType: "ssh-ed25519",
      hostKeyAlgorithm: "sha256",
      hostKeyChangedCount: 0,
      name: "test",
    },
  );
  return new Promise<boolean>((resolve) =>
    verifier(Buffer.from("new-key"), resolve),
  );
}

describe("host key recovery", () => {
  it("announces an accepted and saved replacement key", async () => {
    expect(await verifyChangedKey("accept")).toBe(true);
    expect(updateHostKey).toHaveBeenCalledOnce();
    expect(accepted).toEqual([{ hostId }]);
  });

  it("announces nothing when the new key is rejected", async () => {
    expect(await verifyChangedKey("reject")).toBe(false);
    expect(updateHostKey).not.toHaveBeenCalled();
    expect(accepted).toEqual([]);
  });

  it("announces nothing if persisting the accepted key fails", async () => {
    updateHostKey.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await verifyChangedKey("accept")).toBe(false);
    expect(accepted).toEqual([]);
  });
});

describe("a host missing from the database", () => {
  function answeringSocket(action: "accept" | "reject") {
    const socket = new EventEmitter() as EventEmitter & {
      send: (data: string) => void;
    };
    socket.send = () =>
      socket.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "host_key_verification_response",
            data: { action },
          }),
        ),
      );
    return socket as unknown as WebSocket;
  }

  async function verifyMissingHost(ws: WebSocket | null) {
    const verifier = await SSHHostKeyVerifier.createHostVerifier(
      hostId,
      "127.0.0.1",
      22,
      ws,
      "user",
      false,
      null,
    );
    return new Promise<boolean>((resolve) =>
      verifier(Buffer.from("any-key"), resolve),
    );
  }

  it("refuses the key when nobody can be asked", async () => {
    expect(await verifyMissingHost(null)).toBe(false);
  });

  it("asks the user and saves nothing", async () => {
    expect(await verifyMissingHost(answeringSocket("accept"))).toBe(true);
    expect(await verifyMissingHost(answeringSocket("reject"))).toBe(false);
    expect(updateHostKey).not.toHaveBeenCalled();
  });
});
