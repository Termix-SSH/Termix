import { describe, expect, it } from "vitest";
import { validateCaSettings } from "../../src/backend/client.js";

describe("validateCaSettings", () => {
  it("accepts an https URL and a SHA-256 fingerprint", () => {
    expect(
      validateCaSettings({
        caUrl: "https://ca.example.com:9000/",
        fingerprint: "ab".repeat(32),
      }),
    ).toEqual({});
  });

  it("rejects a plain http URL and a short fingerprint at save time", () => {
    const errors = validateCaSettings({
      caUrl: "http://ca.example.com",
      fingerprint: "abcd",
    });
    expect(Object.keys(errors).sort()).toEqual(["caUrl", "fingerprint"]);
  });

  it("leaves empty fields to the not-configured message", () => {
    expect(validateCaSettings({ caUrl: "", fingerprint: " " })).toEqual({});
  });
});
