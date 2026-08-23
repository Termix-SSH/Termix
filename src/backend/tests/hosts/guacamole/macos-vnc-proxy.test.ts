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
  it("normalizes Apple's private RFB banner and forces classic VNC auth", async () => {
    let clientBanner = "";
    let selectedSecurityType = 0;
    const target = net.createServer((socket) => {
      socket.write("RFB 003.");
      socket.write("889\n");
      socket.once("data", (data) => {
        clientBanner = data.toString("ascii");
        socket.write(Buffer.from([5, 30, 33]));
        socket.write(Buffer.from([36, 2, 35]));
        socket.once("data", (selection) => {
          selectedSecurityType = selection[0];
          socket.write("desktop-data");
        });
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
    expect([...(await read(client, 2))]).toEqual([1, 2]);
    client.write(Buffer.from([2]));
    expect((await read(client, 12)).toString("ascii")).toBe("desktop-data");
    expect(clientBanner).toBe("RFB 003.008\n");
    expect(selectedSecurityType).toBe(2);
  });

  it("passes standard RFB negotiation through unchanged", async () => {
    const target = net.createServer((socket) => {
      socket.write("RFB 003.008\n");
      socket.once("data", () => socket.write(Buffer.from([2, 30, 2])));
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
    expect((await read(client, 12)).toString("ascii")).toBe("RFB 003.008\n");
    client.write("RFB 003.008\n");
    expect([...(await read(client, 3))]).toEqual([2, 30, 2]);
  });

  it("passes Apple's security types through when VNC auth is unavailable", async () => {
    const target = net.createServer((socket) => {
      socket.write("RFB 003.889\n");
      socket.once("data", () => socket.write(Buffer.from([2, 30, 33])));
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
    expect((await read(client, 12)).toString("ascii")).toBe("RFB 003.008\n");
    client.write("RFB 003.008\n");
    expect([...(await read(client, 3))]).toEqual([2, 30, 33]);
  });
});
