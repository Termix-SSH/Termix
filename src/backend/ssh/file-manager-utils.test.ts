import { describe, it, expect } from "vitest";
import {
  isExecutableFile,
  modeToPermissions,
  formatMtime,
  getMimeType,
  detectBinary,
} from "./file-manager-utils.js";

describe("isExecutableFile", () => {
  it("flags scripts with execute permission", () => {
    expect(isExecutableFile("-rwxr-xr-x", "deploy.sh")).toBe(true);
    expect(isExecutableFile("-rwxr-xr-x", "run.py")).toBe(true);
  });

  it("flags known executable extensions with execute permission", () => {
    expect(isExecutableFile("-rwxr-xr-x", "tool.bin")).toBe(true);
    expect(isExecutableFile("-rwxr-xr-x", "app.exe")).toBe(true);
  });

  it("flags extensionless files with execute permission", () => {
    expect(isExecutableFile("-rwxr-xr-x", "myprogram")).toBe(true);
  });

  it("does not flag files without execute permission", () => {
    expect(isExecutableFile("-rw-r--r--", "deploy.sh")).toBe(false);
    expect(isExecutableFile("-rw-r--r--", "myprogram")).toBe(false);
  });

  it("does not flag non-script data files even when executable", () => {
    expect(isExecutableFile("-rwxr-xr-x", "notes.txt")).toBe(false);
  });
});

describe("modeToPermissions", () => {
  it("renders a regular file with rwxr-xr-x", () => {
    expect(modeToPermissions(0o100755)).toBe("-rwxr-xr-x");
  });

  it("renders a directory prefix", () => {
    expect(modeToPermissions(0o040755)).toBe("drwxr-xr-x");
  });

  it("renders a symlink prefix", () => {
    expect(modeToPermissions(0o120777)).toBe("lrwxrwxrwx");
  });

  it("renders a read-only file", () => {
    expect(modeToPermissions(0o100444)).toBe("-r--r--r--");
  });

  it("renders no permissions", () => {
    expect(modeToPermissions(0o100000)).toBe("----------");
  });
});

describe("formatMtime", () => {
  it("uses HH:MM format for recent timestamps", () => {
    // Within the last 6 months relative to now.
    const recent = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 5;
    const result = formatMtime(recent);
    expect(result).toMatch(/^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}$/);
  });

  it("uses the year for old timestamps", () => {
    // ~2 years ago is comfortably outside the 6-month window.
    const old = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365 * 2;
    const result = formatMtime(old);
    expect(result).toMatch(/^[A-Z][a-z]{2} +\d{1,2} +\d{4}$/);
  });
});

describe("getMimeType", () => {
  it("maps known extensions", () => {
    expect(getMimeType("readme.txt")).toBe("text/plain");
    expect(getMimeType("data.json")).toBe("application/json");
    expect(getMimeType("photo.JPEG")).toBe("image/jpeg");
    expect(getMimeType("archive.zip")).toBe("application/zip");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(getMimeType("mystery.xyz")).toBe("application/octet-stream");
    expect(getMimeType("noextension")).toBe("application/octet-stream");
  });
});

describe("detectBinary", () => {
  it("returns false for empty buffers", () => {
    expect(detectBinary(Buffer.from([]))).toBe(false);
  });

  it("returns false for plain UTF-8 text", () => {
    expect(detectBinary(Buffer.from("hello world\nsecond line\t tab"))).toBe(
      false,
    );
  });

  it("returns true when null bytes are present", () => {
    expect(detectBinary(Buffer.from([0x48, 0x00, 0x49, 0x00]))).toBe(true);
  });

  it("allows common whitespace control characters", () => {
    expect(detectBinary(Buffer.from("line1\r\nline2\tend"))).toBe(false);
  });
});
