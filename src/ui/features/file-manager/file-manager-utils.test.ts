import { describe, it, expect } from "vitest";
import { formatFileSize } from "./file-manager-utils.js";

describe("formatFileSize", () => {
  it("returns a dash for undefined or null", () => {
    expect(formatFileSize(undefined)).toBe("-");
    expect(formatFileSize(null as unknown as number)).toBe("-");
  });

  it("returns 0 B for zero", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes without decimals", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal under 10", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("rounds to whole numbers at or above 10 units", () => {
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("scales up to larger units", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
  });
});
