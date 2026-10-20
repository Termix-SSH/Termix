import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const ssh2 = require("ssh2");
const {
  patchKeyParserSource,
  patchAgentSource,
  patchProtocolSource,
} = require("../../../../scripts/patch-ssh2-sk.cjs");

const SK_ED = "sk-ssh-ed25519@openssh.com";

function str(value: Buffer | string): Buffer {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
}

function skPublicBlob(): Buffer {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return Buffer.concat([str(SK_ED), str(raw), str("ssh:")]);
}

it("patches are idempotent on the installed dependency", () => {
  const files: Array<[string, (s: string) => string]> = [
    ["ssh2/lib/protocol/keyParser.js", patchKeyParserSource],
    ["ssh2/lib/agent.js", patchAgentSource],
    ["ssh2/lib/protocol/Protocol.js", patchProtocolSource],
  ];
  for (const [id, patch] of files) {
    const source = readFileSync(require.resolve(id), "utf8");
    const result = patch(source);
    expect(patch(result)).toBe(result);
  }
});

it("fails explicitly when the dependency changes", () => {
  expect(() => patchKeyParserSource("changed")).toThrow("review");
  expect(() => patchAgentSource("changed")).toThrow("review");
  expect(() => patchProtocolSource("changed")).toThrow("review");
});

it("parses a security key public blob and keeps it byte for byte", () => {
  const blob = skPublicBlob();
  const key = ssh2.utils.parseKey(blob);
  expect(key).not.toBeInstanceOf(Error);
  expect(key.type).toBe(SK_ED);
  expect(Buffer.compare(key.getPublicSSH(), blob)).toBe(0);
});

it("sends flags and counter after the signature in publickey auth", async () => {
  const blob = skPublicBlob();
  const key = ssh2.utils.parseKey(blob);
  const trailer = Buffer.from([0x01, 0, 0, 0, 7]);
  const signature = Buffer.alloc(64, 9);
  (signature as Buffer & { skTrailer?: Buffer }).skTrailer = trailer;

  class FakeAgent extends ssh2.BaseAgent {
    getIdentities(cb: (err: Error | null, keys?: unknown[]) => void) {
      cb(null, [key]);
    }
    sign(
      _key: unknown,
      _data: Buffer,
      _opts: unknown,
      cb: (err: Error | null, sig?: Buffer) => void,
    ) {
      cb(null, signature);
    }
  }

  const hostKey = ssh2.utils.generateKeyPairSync("ed25519").private;
  const received = await new Promise<Buffer>((resolve) => {
    const server = new ssh2.Server({ hostKeys: [hostKey] }, (client: any) => {
      client.on("authentication", (ctx: any) => {
        if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
        if (!ctx.signature) return ctx.accept();
        resolve(
          Buffer.concat([
            Buffer.from(ctx.key.data),
            Buffer.from(ctx.signature),
          ]),
        );
        ctx.reject();
      });
      client.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const conn = new ssh2.Client();
      conn.on("error", () => {});
      conn.on("close", () => server.close());
      conn.connect({
        host: "127.0.0.1",
        port: server.address().port,
        username: "u",
        agent: new FakeAgent(),
        readyTimeout: 5000,
      });
    });
  });
  expect(
    Buffer.compare(
      received,
      Buffer.concat([blob, Buffer.alloc(64, 9), trailer]),
    ),
  ).toBe(0);
});
