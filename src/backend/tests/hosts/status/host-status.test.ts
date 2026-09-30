import { describe, expect, it } from "vitest";
import {
  isHostKeyVerificationError,
  statusAfterAuthentication,
  statusAfterReachabilityCheck,
} from "../../../hosts/status/host-status.js";

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

describe("host availability status", () => {
  it("calls a host whose port answers online", () => {
    expect(statusAfterReachabilityCheck(true, false)).toBe("online");
    expect(statusAfterReachabilityCheck(false, false)).toBe("offline");
  });

  it("warns about a reachable host whose last login failed", () => {
    expect(statusAfterReachabilityCheck(true, true)).toBe("reachable");
    expect(statusAfterReachabilityCheck(false, true)).toBe("offline");
  });

  it("marks successful authentication online", () => {
    expect(statusAfterAuthentication(true, "reachable")).toBe("online");
  });

  it("downgrades failed authentication without hiding reachability", () => {
    expect(statusAfterAuthentication(false, "online")).toBe("reachable");
    expect(statusAfterAuthentication(false, "offline")).toBe("offline");
  });
});
