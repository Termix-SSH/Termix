import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import ssh2Pkg, { type ParsedKey } from "ssh2";
import { MemoryAgent } from "../../src/backend/helpers.js";

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
