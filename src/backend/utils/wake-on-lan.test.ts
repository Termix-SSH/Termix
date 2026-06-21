import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("dgram", () => {
  const socket = {
    once: vi.fn(),
    bind: vi.fn(),
    setBroadcast: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
  return { default: { createSocket: vi.fn(() => socket) } };
});

import dgram from "dgram";
import { isValidMac, buildMagicPacket, sendWakeOnLan } from "./wake-on-lan.js";

describe("isValidMac", () => {
  it("accepts colon-separated MAC addresses", () => {
    expect(isValidMac("01:23:45:67:89:AB")).toBe(true);
    expect(isValidMac("aa:bb:cc:dd:ee:ff")).toBe(true);
  });

  it("accepts hyphen-separated MAC addresses", () => {
    expect(isValidMac("01-23-45-67-89-AB")).toBe(true);
  });

  it("rejects malformed MAC addresses", () => {
    expect(isValidMac("")).toBe(false);
    expect(isValidMac("01:23:45:67:89")).toBe(false);
    expect(isValidMac("01:23:45:67:89:AB:CD")).toBe(false);
    expect(isValidMac("0123456789AB")).toBe(false);
    expect(isValidMac("zz:23:45:67:89:ab")).toBe(false);
    expect(isValidMac("01:23:45:67:89:AB ")).toBe(false);
  });
});

describe("buildMagicPacket", () => {
  it("produces a 102-byte packet", () => {
    const packet = buildMagicPacket("01:23:45:67:89:AB");
    expect(packet.length).toBe(102);
  });

  it("starts with six 0xFF bytes", () => {
    const packet = buildMagicPacket("01:23:45:67:89:AB");
    expect([...packet.subarray(0, 6)]).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it("repeats the MAC bytes 16 times after the header", () => {
    const packet = buildMagicPacket("01:23:45:67:89:AB");
    const mac = Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
    for (let i = 0; i < 16; i++) {
      const offset = 6 + i * 6;
      expect([...packet.subarray(offset, offset + 6)]).toEqual([...mac]);
    }
  });

  it("treats colon and hyphen separators identically", () => {
    const colon = buildMagicPacket("aa:bb:cc:dd:ee:ff");
    const hyphen = buildMagicPacket("aa-bb-cc-dd-ee-ff");
    expect(colon.equals(hyphen)).toBe(true);
  });
});

describe("sendWakeOnLan", () => {
  let mockSocket: ReturnType<typeof dgram.createSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket = (dgram.createSocket as ReturnType<typeof vi.fn>)();
    (mockSocket.bind as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: () => void) => cb(),
    );
    (mockSocket.send as ReturnType<typeof vi.fn>).mockImplementation(
      (
        _buf: unknown,
        _off: unknown,
        _len: unknown,
        _port: unknown,
        _addr: unknown,
        cb: (err: null) => void,
      ) => cb(null),
    );
  });

  it("rejects on invalid MAC address", async () => {
    await expect(sendWakeOnLan("not-a-mac")).rejects.toThrow(
      "Invalid MAC address",
    );
  });

  it("sends to 255.255.255.255 by default", async () => {
    await sendWakeOnLan("aa:bb:cc:dd:ee:ff");
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.any(Buffer),
      0,
      102,
      9,
      "255.255.255.255",
      expect.any(Function),
    );
  });

  it("sends to a custom broadcast address when provided", async () => {
    await sendWakeOnLan("aa:bb:cc:dd:ee:ff", "192.168.1.255");
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.any(Buffer),
      0,
      102,
      9,
      "192.168.1.255",
      expect.any(Function),
    );
  });
});
