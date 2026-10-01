import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client, Server, utils, type SFTPWrapper } from "ssh2";
import { expect, it } from "vitest";
import { createDownloadStream } from "../../src/backend/download-stream.js";

it("overlaps real SFTP reads while retaining the serial stream's byte content", async () => {
  const data = Buffer.alloc(1024 * 1024 + 71);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >>> 10)) % 256;
  let pending = 0;
  let peak = 0;
  let closed = 0;
  const server = new Server(
    {
      hostKeys: [utils.generateKeyPairSync("rsa", { bits: 2048 }).private],
    },
    (client) => {
      client.on("authentication", (ctx) => ctx.accept());
      client.on("ready", () =>
        client.on("session", (accept) => {
          accept().on("sftp", (acceptSftp) => {
            const sftp = acceptSftp();
            sftp.on("OPEN", (id) => sftp.handle(id, Buffer.from("file")));
            sftp.on("READ", (id, _handle, offset, length) => {
              peak = Math.max(peak, ++pending);
              setTimeout(() => {
                pending--;
                if (offset >= data.length) sftp.status(id, 1);
                else sftp.data(id, data.subarray(offset, offset + length));
              }, 10);
            });
            sftp.on("CLOSE", (id) => {
              closed++;
              sftp.status(id, 0);
            });
          });
        }),
      );
    },
  );
  const client = new Client();
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    client.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      username: "test",
    });
    await once(client, "ready");
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      client.sftp((err, channel) => (err ? reject(err) : resolve(channel))),
    );
    const serial: Buffer[] = [];
    for await (const chunk of sftp.createReadStream("/file"))
      serial.push(chunk);
    expect(Buffer.concat(serial)).toEqual(data);
    expect(peak).toBe(1);
    peak = 0;
    const pipelined: Buffer[] = [];
    for await (const chunk of createDownloadStream(sftp, "/file", data.length))
      pipelined.push(chunk);
    expect(Buffer.concat(pipelined)).toEqual(data);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(closed).toBe(2);
  } finally {
    const closedClient = once(client, "close");
    client.destroy();
    await closedClient;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);
