import { describe, expect, it } from "vitest";
import { isHostKeyVerificationError } from "../../../hosts/status/host-status.js";

describe("isHostKeyVerificationError", () => {
  it.each([
    "Host denied (verification failed)",
    "Host key changed - please connect via Terminal to verify the new key",
  ])("classifies %s", (message) => {
    expect(isHostKeyVerificationError(new Error(message))).toBe(true);
  });

  it("does not classify ordinary authentication failures", () => {
    expect(isHostKeyVerificationError(new Error("Permission denied"))).toBe(
      false,
    );
  });
});
