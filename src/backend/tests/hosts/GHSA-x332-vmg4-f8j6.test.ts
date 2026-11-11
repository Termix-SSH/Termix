import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  updateHostKey: vi.fn(async () => {}),
  storeHostKey: vi.fn(async () => {}),
  touchHostKeyLastVerified: vi.fn(async () => {}),
}));
const settings = vi.hoisted(() => new Map<string, string>());
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => {}) }));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => repo,
  getCurrentSettingValue: (key: string) => settings.get(key) ?? null,
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: audit.logAudit,
  getAuditUsername: async (id: string) => id,
}));

const { SSHHostKeyVerifier } = await import("../../hosts/host-key-verifier.js");

const unpinned = {
  hostKeyFingerprint: null,
  hostKeyType: null,
  hostKeyAlgorithm: null,
  hostKeyChangedCount: 0,
  name: "web",
};

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

async function verify(
  hostId: number | null,
  socket: WebSocket | null,
  isJump = false,
  onRefused?: (code: string, message: string) => void,
) {
  const verifier = await SSHHostKeyVerifier.createHostVerifier(
    hostId,
    "10.0.0.9",
    22,
    socket,
    "user-1",
    isJump,
    hostId ? unpinned : null,
    { onRefused },
  );
  return new Promise<boolean>((resolve) =>
    verifier(Buffer.from("first-key"), resolve),
  );
}

beforeEach(() => {
  settings.clear();
  repo.storeHostKey.mockClear();
  audit.logAudit.mockClear();
});

describe("GHSA-x332-vmg4-f8j6 host keys with nobody to ask", () => {
  it("refuses a stored host with no saved key", async () => {
    const refused = vi.fn();
    expect(await verify(5, null, false, refused)).toBe(false);
    expect(repo.storeHostKey).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledWith(
      "HOST_KEY_UNVERIFIED",
      expect.stringMatching(/terminal/i),
    );
  });

  it("refuses jump host first contact with no socket", async () => {
    expect(await verify(6, null, true)).toBe(false);
    expect(repo.storeHostKey).not.toHaveBeenCalled();
  });

  it("asks about a jump host's first key when a socket is there", async () => {
    const no = socketAnswering("reject");
    expect(await verify(6, no.socket, true)).toBe(false);
    expect(no.sent[0]).toContain("host_key_verification_required");
    expect(repo.storeHostKey).not.toHaveBeenCalled();

    const yes = socketAnswering("accept");
    expect(await verify(6, yes.socket, true)).toBe(true);
    expect(repo.storeHostKey).toHaveBeenCalledTimes(1);
  });

  it("refuses an unsaved host with no socket", async () => {
    expect(await verify(null, null)).toBe(false);
  });

  it("pins and audits the first key when the admin allows trust on first use", async () => {
    settings.set("host_key_trust_on_first_use", "true");
    expect(await verify(5, null)).toBe(true);
    expect(repo.storeHostKey).toHaveBeenCalledWith(
      5,
      Buffer.from("first-key").toString("hex"),
      expect.any(String),
      "sha256",
    );
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "host_key_trusted_first_use" }),
    );

    expect(await verify(6, null, true)).toBe(true);
    expect(await verify(null, null)).toBe(true);
  });
});

describe("GHSA-x332-vmg4-f8j6 refusal errors", () => {
  it("replaces ssh2's generic error with the reason and a code", async () => {
    const { explainHostKeyRefusal } =
      await import("../../hosts/host-key-policy.js");
    const client = new EventEmitter();
    const seen: Array<Error & { code?: string }> = [];
    client.on("error", (error) => seen.push(error));
    explainHostKeyRefusal(client, "HOST_KEY_UNVERIFIED");
    client.emit("error", new Error("Host denied (verification failed)"));
    expect(seen[0].code).toBe("HOST_KEY_UNVERIFIED");
    expect(seen[0].message).toMatch(/terminal/i);

    client.emit("error", new Error("something else"));
    expect(seen[1].message).toBe("something else");
  });
});
