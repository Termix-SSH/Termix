import type { Duplex } from "stream";
import { tunnelLogger } from "../utils/logger.js";

function parseSocksAddress(buffer: Buffer): {
  address: string;
  port: number;
  bytesRead: number;
} | null {
  if (buffer.length < 7 || buffer[0] !== 0x05 || buffer[1] !== 0x01) {
    return null;
  }

  const addressType = buffer[3];
  let offset = 4;
  let address: string;

  if (addressType === 0x01) {
    if (buffer.length < offset + 4 + 2) return null;
    address = Array.from(buffer.subarray(offset, offset + 4)).join(".");
    offset += 4;
  } else if (addressType === 0x03) {
    const len = buffer[offset];
    offset += 1;
    if (buffer.length < offset + len + 2) return null;
    address = buffer.subarray(offset, offset + len).toString("utf8");
    offset += len;
  } else if (addressType === 0x04) {
    if (buffer.length < offset + 16 + 2) return null;
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(buffer.readUInt16BE(offset + i).toString(16));
    }
    address = parts.join(":");
    offset += 16;
  } else {
    return null;
  }

  const port = buffer.readUInt16BE(offset);
  return { address, port, bytesRead: offset + 2 };
}

export function handleSocks5Connect(
  inbound: Duplex,
  openOutbound: (host: string, port: number) => Promise<Duplex>,
  tunnelName: string,
): void {
  let buffer = Buffer.alloc(0);
  let stage: "greeting" | "connect" | "piping" = "greeting";

  const fail = (code = 0x01) => {
    if (!inbound.destroyed) {
      inbound.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      inbound.destroy();
    }
  };

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (stage === "greeting") {
      if (buffer.length < 2) return;
      if (buffer[0] !== 0x05) {
        fail(0x01);
        return;
      }
      const methodsLength = buffer[1];
      if (buffer.length < 2 + methodsLength) return;
      inbound.write(Buffer.from([0x05, 0x00]));
      buffer = buffer.subarray(2 + methodsLength);
      stage = "connect";
    }

    if (stage === "connect") {
      const parsed = parseSocksAddress(buffer);
      if (!parsed) return;
      stage = "piping";
      inbound.off("data", onData);
      const remainder = buffer.subarray(parsed.bytesRead);
      openOutbound(parsed.address, parsed.port)
        .then((outbound) => {
          inbound.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
          );
          if (remainder.length > 0) {
            outbound.write(remainder);
          }
          inbound.pipe(outbound).pipe(inbound);
          inbound.on("error", () => outbound.destroy());
          outbound.on("error", () => inbound.destroy());
        })
        .catch((error) => {
          tunnelLogger.error("SOCKS5 tunnel connect failed", error, {
            operation: "managed_tunnel_socks_connect_failed",
            tunnelName,
            targetHost: parsed.address,
            targetPort: parsed.port,
          });
          fail(0x05);
        });
    }
  };

  inbound.on("data", onData);
  inbound.on("error", () => inbound.destroy());
}
