import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier.js";

const repo = vi.hoisted(() => ({
  updateHostKey: vi.fn(async () => {}),
  storeHostKey: vi.fn(async () => {}),
  touchHostKeyLastVerified: vi.fn(async () => {}),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => repo,
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function socketAnswering(action: "accept" | "reject") {
  const sent: string[] = [];
  const socket = new EventEmitter() as EventEmitter & {
    send: (data: string) => void;
  };
  socket.send = (data) => {
    sent.push(data);
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
  return { socket: socket as unknown as WebSocket, sent };
}

async function verifyUnsaved(socket: WebSocket | null) {
  const verifier = await SSHHostKeyVerifier.createHostVerifier(
    null,
    "10.0.0.5",
    22,
    socket,
    "user",
  );
  return new Promise<boolean>((resolve) =>
    verifier(Buffer.from("quick-key"), resolve),
  );
}

describe("quick connect host keys", () => {
  it("asks the user and uses their answer", async () => {
    const yes = socketAnswering("accept");
    expect(await verifyUnsaved(yes.socket)).toBe(true);
    expect(yes.sent[0]).toContain("host_key_verification_required");

    const no = socketAnswering("reject");
    expect(await verifyUnsaved(no.socket)).toBe(false);
  });

  it("still connects when there is no socket to ask on", async () => {
    expect(await verifyUnsaved(null)).toBe(true);
  });
});

const pinned = {
  hostKeyFingerprint: Buffer.from("old-key").toString("hex"),
  hostKeyType: "ssh-ed25519",
  hostKeyAlgorithm: "sha256",
  hostKeyChangedCount: 0,
  name: "bastion",
};

async function verifyJumpHop(socket: WebSocket | null, key: string) {
  const verifier = await SSHHostKeyVerifier.createHostVerifier(
    7,
    "10.0.0.1",
    22,
    socket,
    "user",
    true,
    pinned,
  );
  return new Promise<boolean>((resolve) => verifier(Buffer.from(key), resolve));
}

describe("jump host key changes", () => {
  beforeEach(() => {
    repo.updateHostKey.mockClear();
  });

  it("refuses a changed key and keeps the pin when nobody can be asked", async () => {
    expect(await verifyJumpHop(null, "new-key")).toBe(false);
    expect(repo.updateHostKey).not.toHaveBeenCalled();
  });

  it("asks the user and only replaces the pin when they accept", async () => {
    const no = socketAnswering("reject");
    expect(await verifyJumpHop(no.socket, "new-key")).toBe(false);
    expect(no.sent[0]).toContain("host_key_changed");
    expect(repo.updateHostKey).not.toHaveBeenCalled();

    const yes = socketAnswering("accept");
    expect(await verifyJumpHop(yes.socket, "new-key")).toBe(true);
    expect(repo.updateHostKey).toHaveBeenCalledTimes(1);
  });

  it("still accepts the pinned key without asking", async () => {
    expect(await verifyJumpHop(null, "old-key")).toBe(true);
  });
});
