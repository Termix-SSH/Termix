import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import ssh2Pkg, { type ParsedKey } from "ssh2";

const mockAccess = vi.fn();

vi.mock("fs/promises", () => ({
  access: mockAccess,
}));

import {
  MemoryAgent,
  FilteredAgent,
  resolveAgentSocket,
} from "../../hosts/terminal-auth-helpers.js";

describe("MemoryAgent", () => {
  it("serves identities and signatures over the agent protocol", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const parsed = ssh2Pkg.utils.parseKey(
      privateKey.export({ type: "pkcs1", format: "pem" }),
    );
    expect(parsed).not.toBeInstanceOf(Error);

    const agent = new MemoryAgent(parsed as ParsedKey);
    const stream = await new Promise<NodeJS.ReadWriteStream>(
      (resolve, reject) => {
        agent.getStream((error, result) => {
          if (error || !result)
            reject(error ?? new Error("Missing agent stream"));
          else resolve(result);
        });
      },
    );
    const client = new ssh2Pkg.AgentProtocol(true);
    client.pipe(stream).pipe(client);

    const identities = await new Promise<ParsedKey[]>((resolve, reject) => {
      client.getIdentities((error, keys) => {
        if (error || !keys) reject(error ?? new Error("Missing identities"));
        else resolve(keys);
      });
    });
    expect(identities).toHaveLength(1);
    expect(identities[0].getPublicSSH()).toEqual(
      (parsed as ParsedKey).getPublicSSH(),
    );

    const data = Buffer.from("forwarded-agent-test");
    const signature = await new Promise<Buffer>((resolve, reject) => {
      client.sign(identities[0], data, (error, result) => {
        if (error || !result) reject(error ?? new Error("Missing signature"));
        else resolve(result);
      });
    });
    expect((parsed as ParsedKey).verify(data, signature)).toBe(true);

    client.destroy();
    stream.destroy();
  });
});

describe("resolveAgentSocket", () => {
  const originalEnv = process.env.SSH_AUTH_SOCK;
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockAccess.mockReset();
    delete process.env.SSH_AUTH_SOCK;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SSH_AUTH_SOCK = originalEnv;
    } else {
      delete process.env.SSH_AUTH_SOCK;
    }
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("uses explicit socket path from terminalConfig over SSH_AUTH_SOCK", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-env/agent.123";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({
      agentSocketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    });

    expect(result).toEqual({
      socketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    });
    expect(mockAccess).toHaveBeenCalledWith(
      "/run/user/1000/gnupg/S.gpg-agent.ssh",
    );
  });

  it("falls back to SSH_AUTH_SOCK when no explicit path is provided", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.456";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({});

    expect(result).toEqual({ socketPath: "/tmp/ssh-XXXX/agent.456" });
  });

  it("falls back to SSH_AUTH_SOCK when agentSocketPath is empty string", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.789";
    mockAccess.mockResolvedValue(undefined);

    const result = await resolveAgentSocket({ agentSocketPath: "  " });

    expect(result).toEqual({ socketPath: "/tmp/ssh-XXXX/agent.789" });
  });

  it("returns error when neither SSH_AUTH_SOCK nor explicit path is set", async () => {
    const result = await resolveAgentSocket({});

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("SSH_AUTH_SOCK");
  });

  it("returns error when terminalConfig is undefined and SSH_AUTH_SOCK is not set", async () => {
    const result = await resolveAgentSocket(undefined);

    expect(result).toHaveProperty("error");
  });

  it("returns error on non-Windows when socket file is missing", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SSH_AUTH_SOCK = "/tmp/missing-agent.sock";
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveAgentSocket({});

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      "/tmp/missing-agent.sock",
    );
  });

  it("skips file existence check on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.SSH_AUTH_SOCK = "\\\\.\\pipe\\openssh-ssh-agent";

    const result = await resolveAgentSocket({});

    expect(result).toEqual({
      socketPath: "\\\\.\\pipe\\openssh-ssh-agent",
    });
    expect(mockAccess).not.toHaveBeenCalled();
  });
});

describe("FilteredAgent", () => {
  it("only returns identities matching the configured public key", async () => {
    const { privateKey: keyA } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const { privateKey: keyB } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const parsedA = ssh2Pkg.utils.parseKey(
      keyA.export({ type: "pkcs1", format: "pem" }),
    ) as ParsedKey;
    const parsedB = ssh2Pkg.utils.parseKey(
      keyB.export({ type: "pkcs1", format: "pem" }),
    ) as ParsedKey;

    const inner = {
      getIdentities: (cb: (err: Error | null, keys: ParsedKey[]) => void) =>
        cb(null, [parsedA, parsedB]),
      getStream: vi.fn(),
      sign: vi.fn(),
    };

    const filtered = new FilteredAgent(
      inner as unknown as ConstructorParameters<typeof FilteredAgent>[0],
      parsedB.getPublicSSH(),
    );

    const identities = await new Promise<ParsedKey[]>((resolve, reject) => {
      filtered.getIdentities((err, keys) => {
        if (err || !keys) reject(err ?? new Error("Missing identities"));
        else resolve(keys);
      });
    });

    expect(identities).toHaveLength(1);
    expect(identities[0].getPublicSSH()).toEqual(parsedB.getPublicSSH());
  });

  it("returns no identities when nothing matches", async () => {
    const { privateKey: keyA } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const { privateKey: keyB } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const parsedA = ssh2Pkg.utils.parseKey(
      keyA.export({ type: "pkcs1", format: "pem" }),
    ) as ParsedKey;
    const parsedB = ssh2Pkg.utils.parseKey(
      keyB.export({ type: "pkcs1", format: "pem" }),
    ) as ParsedKey;

    const inner = {
      getIdentities: (cb: (err: Error | null, keys: ParsedKey[]) => void) =>
        cb(null, [parsedA]),
      getStream: vi.fn(),
      sign: vi.fn(),
    };

    const filtered = new FilteredAgent(
      inner as unknown as ConstructorParameters<typeof FilteredAgent>[0],
      parsedB.getPublicSSH(),
    );

    const identities = await new Promise<ParsedKey[]>((resolve, reject) => {
      filtered.getIdentities((err, keys) => {
        if (err || !keys) reject(err ?? new Error("Missing identities"));
        else resolve(keys);
      });
    });

    expect(identities).toHaveLength(0);
  });
});

describe("MemoryAgent unsupported extension framing", () => {
  it.each([false, true])(
    "can enumerate keys after rejecting session-bind (fragmented=%s)",
    async (fragmented) => {
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const key = ssh2Pkg.utils.parseKey(
        privateKey.export({ type: "pkcs1", format: "pem" }),
      ) as ParsedKey;
      const agent = new MemoryAgent(key);
      const stream = await new Promise<NodeJS.ReadWriteStream>(
        (resolve, reject) => {
          agent.getStream((error, result) =>
            error || !result ? reject(error) : resolve(result),
          );
        },
      );
      const replies: Buffer[] = [];
      let buffered = Buffer.alloc(0);
      stream.on("data", (data: Buffer) => {
        buffered = Buffer.concat([buffered, data]);
        while (
          buffered.length >= 4 &&
          buffered.length >= buffered.readUInt32BE(0) + 4
        ) {
          const end = buffered.readUInt32BE(0) + 4;
          replies.push(buffered.subarray(4, end));
          buffered = buffered.subarray(end);
        }
      });
      const extension = Buffer.from("session-bind@openssh.com");
      const request = Buffer.alloc(4 + 1 + 4 + extension.length);
      request.writeUInt32BE(request.length - 4, 0);
      request[4] = 27;
      request.writeUInt32BE(extension.length, 5);
      extension.copy(request, 9);
      const identities = Buffer.from([0, 0, 0, 1, 11]);
      try {
        const requests = Buffer.concat([request, identities]);
        if (fragmented) {
          stream.write(requests.subarray(0, 7));
          stream.write(requests.subarray(7));
        } else stream.write(requests);
        await vi.waitFor(() => expect(replies).toHaveLength(2));
        expect(replies[0][0]).toBe(5); // Unsupported extension remains refused.
        expect(replies[1][0]).toBe(12); // The following identities request succeeds.
        expect(replies[1].readUInt32BE(1)).toBe(1);
      } finally {
        stream.destroy();
      }
    },
  );
});
