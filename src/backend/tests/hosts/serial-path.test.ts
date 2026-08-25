import { describe, expect, it } from "vitest";
import { isAllowedSerialPath } from "../../hosts/serial.js";

/**
 * `path` arrives over the WebSocket from any authenticated user, and SerialPort
 * opens whatever it is given - so without this check the serial feature was
 * read/write access to arbitrary device nodes on the Termix host itself.
 */
describe("isAllowedSerialPath", () => {
  it("accepts the places real serial devices live", () => {
    for (const path of [
      "/dev/ttyS0",
      "/dev/ttyUSB0",
      "/dev/ttyACM1",
      "/dev/ttyAMA0",
      "/dev/serial/by-id/usb-FTDI_FT232R-if00-port0",
      "/dev/rfcomm0",
      "COM1",
      "com12",
    ]) {
      expect(isAllowedSerialPath(path), path).toBe(true);
    }
  });

  it("rejects paths that are not serial devices", () => {
    for (const path of [
      "/etc/shadow",
      "/dev/sda",
      "/dev/mem",
      // The backend's own controlling terminal, not a serial line.
      "/dev/tty",
      "/proc/self/environ",
      "/dev/ttyS0/../../etc/passwd",
      "/dev/serial/../../../etc/shadow",
    ]) {
      expect(isAllowedSerialPath(path), path).toBe(false);
    }
  });

  it("rejects separator and terminator tricks", () => {
    expect(isAllowedSerialPath("/dev/ttyS0 /etc/shadow")).toBe(false);
    expect(isAllowedSerialPath("/dev/ttyS0\nrm -rf /")).toBe(false);
    expect(isAllowedSerialPath("")).toBe(false);
    expect(isAllowedSerialPath("   ")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isAllowedSerialPath(undefined)).toBe(false);
    expect(isAllowedSerialPath(null)).toBe(false);
    expect(isAllowedSerialPath(42)).toBe(false);
    expect(isAllowedSerialPath({ path: "/dev/ttyS0" })).toBe(false);
  });
});
