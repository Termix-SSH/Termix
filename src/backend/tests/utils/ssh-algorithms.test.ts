import { generateKeyPairSync } from "node:crypto";
import net from "node:net";
import { Client, Server } from "ssh2";
import { describe, expect, it } from "vitest";
import { buildSSHAlgorithms } from "../../utils/ssh-algorithms.js";

// An SSH peer advertising only DH group exchange. Stop after the client's
// plaintext GEX request, before expensive prime validation or authentication.
async function requestedGroupBits(): Promise<number> {
  const name = (value: string) => {
    const data = Buffer.from(value);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    return Buffer.concat([size, data]);
  };
  const payload = Buffer.concat([
    Buffer.from([20]),
    Buffer.alloc(16),
    ...[
      "diffie-hellman-group-exchange-sha256",
      "rsa-sha2-256",
      "aes256-gcm@openssh.com,aes128-gcm@openssh.com",
      "aes256-gcm@openssh.com,aes128-gcm@openssh.com",
      "hmac-sha2-256",
      "hmac-sha2-256",
      "none",
      "none",
      "",
      "",
    ].map(name),
    Buffer.alloc(5),
  ]);
  const padding = 8 - ((payload.length + 5) % 8) + 8;
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length + padding + 1);
  header[4] = padding;
  const client = new Client();
  let peer: net.Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = net.createServer();
  try {
    const result = new Promise<number>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("No SSH group request")), 3000);
      client.on("error", reject);
      server.on("connection", (socket) => {
        peer = socket;
        let buffer = Buffer.alloc(0);
        let banner = false;
        socket.write(
          Buffer.concat([
            Buffer.from("SSH-2.0-OpenSSH_7.4\r\n"),
            header,
            payload,
            Buffer.alloc(padding),
          ]),
        );
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!banner) {
            const end = buffer.indexOf("\n");
            if (end < 0) return;
            buffer = buffer.subarray(end + 1);
            banner = true;
          }
          while (buffer.length >= 5) {
            const length = buffer.readUInt32BE(0) + 4;
            if (buffer.length < length) return;
            if (buffer[5] === 34) resolve(buffer.readUInt32BE(10));
            buffer = buffer.subarray(length);
          }
        });
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    client.connect({
      host: "127.0.0.1",
      port: (server.address() as net.AddressInfo).port,
      username: "test",
      algorithms: buildSSHAlgorithms(false),
    });
    return await result;
  } finally {
    clearTimeout(timer);
    client.destroy();
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("SSH cipher preference", () => {
  it("requests a 3072-bit group from a GEX-only peer offering both GCM ciphers", async () => {
    expect(await requestedGroupBits()).toBe(3072);
  });

  it("still connects when a server only supports AES-256-GCM", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const server = new Server(
      {
        hostKeys: [privateKey.export({ type: "pkcs1", format: "pem" })],
        algorithms: { cipher: ["aes256-gcm@openssh.com"] },
      },
      (peer) => {
        peer.on("authentication", (auth) => auth.accept());
      },
    );
    const client = new Client();
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      await new Promise<void>((resolve, reject) => {
        client.once("ready", resolve).once("error", reject);
        client.connect({
          host: "127.0.0.1",
          port: (server.address() as net.AddressInfo).port,
          username: "test",
          readyTimeout: 2000,
          algorithms: buildSSHAlgorithms(false),
        });
      });
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps legacy algorithms opt-in", () => {
    expect(buildSSHAlgorithms(false).kex).not.toContain(
      "diffie-hellman-group-exchange-sha1",
    );
    expect(buildSSHAlgorithms(true).kex).toContain(
      "diffie-hellman-group-exchange-sha1",
    );
  });
});
