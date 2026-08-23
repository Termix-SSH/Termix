import net from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createMacosVncCompatibilityProxy } from "../../../hosts/guacamole/macos-vnc-proxy.js";

const closers: Array<() => void> = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

async function read(socket: net.Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < length) return;
      socket.off("data", onData);
      resolve(received);
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

describe("createMacosVncCompatibilityProxy", () => {
  it("normalizes Apple's private RFB banner and preserves later traffic", async () => {
    let clientBanner = "";
    const target = net.createServer((socket) => {
      socket.write("RFB 003.");
      socket.write("889\n");
      socket.once("data", (data) => {
        clientBanner = data.toString("ascii");
        socket.write("security-types");
      });
    });
    const targetPort = await listen(target);
    closers.push(() => target.close());

    const proxy = await createMacosVncCompatibilityProxy({
      targetHost: "127.0.0.1",
      targetPort,
      bindHost: "127.0.0.1",
    });
    closers.push(proxy.close);

    const client = net.createConnection(proxy.port, "127.0.0.1");
    closers.push(() => client.destroy());
    expect((await read(client, 12)).subarray(0, 12).toString("ascii")).toBe(
      "RFB 003.008\n",
    );
    client.write("RFB 003.008\n");
    expect((await read(client, 14)).toString("ascii")).toBe("security-types");
    expect(clientBanner).toBe("RFB 003.008\n");
  });

  it("passes standard RFB banners through unchanged", async () => {
    const target = net.createServer((socket) => socket.write("RFB 003.008\n"));
    const targetPort = await listen(target);
    closers.push(() => target.close());
    const proxy = await createMacosVncCompatibilityProxy({
      targetHost: "127.0.0.1",
      targetPort,
      bindHost: "127.0.0.1",
    });
    closers.push(proxy.close);

    const client = net.createConnection(proxy.port, "127.0.0.1");
    closers.push(() => client.destroy());
    expect((await read(client, 12)).toString("ascii")).toBe("RFB 003.008\n");
  });
});
