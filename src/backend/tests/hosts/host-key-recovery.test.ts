import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier.js";
import { authFailureTracker } from "../../hosts/metrics/state.js";

const { updateHostKey } = vi.hoisted(() => ({ updateHostKey: vi.fn() }));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({ updateHostKey }),
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const hostId = 991267;
afterEach(() => {
  authFailureTracker.reset(hostId);
  vi.resetAllMocks();
});

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

describe("metrics recovery after host key verification", () => {
  it("allows polling after accepting and saving the replacement key", async () => {
    authFailureTracker.recordFailure(hostId, "HOST_KEY", true);
    expect(authFailureTracker.shouldSkip(hostId)).toBe(true);
    expect(await verifyChangedKey("accept")).toBe(true);
    expect(updateHostKey).toHaveBeenCalledOnce();
    expect(authFailureTracker.shouldSkip(hostId)).toBe(false);
  });

  it("keeps polling blocked when the new key is rejected", async () => {
    authFailureTracker.recordFailure(hostId, "HOST_KEY", true);
    expect(await verifyChangedKey("reject")).toBe(false);
    expect(updateHostKey).not.toHaveBeenCalled();
    expect(authFailureTracker.shouldSkip(hostId)).toBe(true);
  });

  it("keeps polling blocked if persisting the accepted key fails", async () => {
    authFailureTracker.recordFailure(hostId, "HOST_KEY", true);
    updateHostKey.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await verifyChangedKey("accept")).toBe(false);
    expect(authFailureTracker.shouldSkip(hostId)).toBe(true);
  });

  it.each(["AUTH", "TOTP"] as const)(
    "preserves unrelated %s failures",
    async (reason) => {
      authFailureTracker.recordFailure(hostId, reason, true);
      expect(await verifyChangedKey("accept")).toBe(true);
      expect(authFailureTracker.shouldSkip(hostId)).toBe(true);
    },
  );
});
