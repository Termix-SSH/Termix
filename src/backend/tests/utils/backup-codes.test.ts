import { describe, expect, it } from "vitest";
import {
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  generateBackupCode,
  generateBackupCodes,
} from "../../utils/backup-codes.js";

describe("generateBackupCode", () => {
  it("always produces a full-length code", () => {
    // Math.random().toString(36) drops trailing zeroes, so the old codes were
    // sometimes shorter than advertised.
    for (let i = 0; i < 200; i += 1) {
      expect(generateBackupCode()).toHaveLength(BACKUP_CODE_LENGTH);
    }
  });

  it("stays within the uppercase alphanumeric alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateBackupCode()).toMatch(/^[0-9A-Z]+$/);
    }
  });

  it("uses the whole alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const char of generateBackupCode()) seen.add(char);
    }
    expect(seen.size).toBe(36);
  });
});

describe("generateBackupCodes", () => {
  it("returns the expected number of distinct codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
  });
});
