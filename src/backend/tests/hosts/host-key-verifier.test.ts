import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier.js";

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({}),
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
