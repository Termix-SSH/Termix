import dgram from "dgram";

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

function parseMac(mac: string): Buffer {
  return Buffer.from(mac.replace(/[:-]/g, ""), "hex");
}

function buildMagicPacket(mac: string): Buffer {
  const macBytes = parseMac(mac);
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(packet, 6 + i * 6);
  }
  return packet;
}

export function isValidMac(mac: string): boolean {
  return MAC_REGEX.test(mac);
}

export function sendWakeOnLan(mac: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isValidMac(mac)) {
      return reject(new Error("Invalid MAC address"));
    }

    const packet = buildMagicPacket(mac);
    const socket = dgram.createSocket("udp4");

    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, 9, "255.255.255.255", (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
