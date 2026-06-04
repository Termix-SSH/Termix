import { describe, it, expect } from "vitest";
import { isValidMac, buildMagicPacket } from "./wake-on-lan.js";

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
