import net from "net";

const RFB_BANNER_LENGTH = 12;
const VNC_AUTH_SECURITY_TYPE = 2;
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
    const forwardMacosSecurityTypes = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 1) return;

      const securityTypeCount = pending[0];
      if (securityTypeCount === 0) {
        upstream.off("data", forwardMacosSecurityTypes);
        client.write(pending);
        upstream.pipe(client);
        return;
      }
      if (pending.length < 1 + securityTypeCount) return;

      upstream.off("data", forwardMacosSecurityTypes);
      const securityTypes = pending.subarray(1, 1 + securityTypeCount);
      if (securityTypes.includes(VNC_AUTH_SECURITY_TYPE)) {
        client.write(Buffer.from([1, VNC_AUTH_SECURITY_TYPE]));
      } else {
        client.write(pending.subarray(0, 1 + securityTypeCount));
      }
      client.write(pending.subarray(1 + securityTypeCount));
      upstream.pipe(client);
    };

    const forwardServerBanner = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < RFB_BANNER_LENGTH) return;

      upstream.off("data", forwardServerBanner);
      const banner = pending.subarray(0, RFB_BANNER_LENGTH);
      const remainder = pending.subarray(RFB_BANNER_LENGTH);
      if (banner.equals(MACOS_RFB_BANNER)) {
        client.write(STANDARD_RFB_BANNER);
        pending = Buffer.alloc(0);
        upstream.on("data", forwardMacosSecurityTypes);
        if (remainder.length > 0) forwardMacosSecurityTypes(remainder);
      } else {
        client.write(banner);
        client.write(remainder);
        upstream.pipe(client);
      }
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
