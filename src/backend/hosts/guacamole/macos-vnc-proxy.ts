import net from "net";

const RFB_BANNER_LENGTH = 12;
const MACOS_RFB_BANNER = Buffer.from("RFB 003.889\n", "ascii");
const STANDARD_RFB_BANNER = Buffer.from("RFB 003.008\n", "ascii");

export interface VncCompatibilityProxy {
  port: number;
  close: () => void;
}

export async function createMacosVncCompatibilityProxy({
  targetHost,
  targetPort,
  bindHost,
}: {
  targetHost: string;
  targetPort: number;
  bindHost: string;
}): Promise<VncCompatibilityProxy> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.createConnection(targetPort, targetHost);
    sockets.add(client);
    sockets.add(upstream);

    const forget = (socket: net.Socket) => sockets.delete(socket);
    client.once("close", () => forget(client));
    upstream.once("close", () => forget(upstream));
    client.once("error", () => upstream.destroy());
    upstream.once("error", () => client.destroy());
    client.pipe(upstream);

    let pending = Buffer.alloc(0);
    const forwardServerBanner = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < RFB_BANNER_LENGTH) return;

      upstream.off("data", forwardServerBanner);
      const banner = pending.subarray(0, RFB_BANNER_LENGTH);
      client.write(
        banner.equals(MACOS_RFB_BANNER) ? STANDARD_RFB_BANNER : banner,
      );
      client.write(pending.subarray(RFB_BANNER_LENGTH));
      upstream.pipe(client);
    };
    upstream.on("data", forwardServerBanner);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, bindHost, () => {
      server.off("error", reject);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
  server.unref();

  return {
    port,
    close: () => {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}
