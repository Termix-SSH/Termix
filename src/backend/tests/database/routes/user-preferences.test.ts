import { describe, expect, it } from "vitest";
import { validateDefaultsJson } from "../../../database/routes/user-preferences.js";

describe("user connection defaults validation", () => {
  it("accepts JSON objects", () => {
    expect(validateDefaultsJson('{"fontSize":16}')).toBe(true);
    expect(validateDefaultsJson("{}")).toBe(true);
  });

  it("rejects malformed JSON and non-object values", () => {
    expect(validateDefaultsJson("{")).toBe(false);
    expect(validateDefaultsJson("null")).toBe(false);
    expect(validateDefaultsJson("[]")).toBe(false);
  });

  it("rejects payloads larger than 32 KiB", () => {
    expect(
      validateDefaultsJson(JSON.stringify({ value: "x".repeat(32_768) })),
    ).toBe(false);
  });
});
