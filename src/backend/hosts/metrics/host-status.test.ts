import { describe, expect, it } from "vitest";
import {
  isHostKeyVerificationError,
  statusAfterAuthentication,
  statusAfterReachabilityCheck,
} from "./host-status.js";

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
  it("does not call a TCP-reachable host online before authentication", () => {
    expect(statusAfterReachabilityCheck(true)).toBe("reachable");
  });

  it("keeps a verified host online across later reachability checks", () => {
    expect(statusAfterReachabilityCheck(true, "online")).toBe("online");
  });

  it("marks successful authentication online", () => {
    expect(statusAfterAuthentication(true, "reachable")).toBe("online");
  });

  it("downgrades failed authentication without hiding reachability", () => {
    expect(statusAfterAuthentication(false, "online")).toBe("reachable");
    expect(statusAfterAuthentication(false, "offline")).toBe("offline");
  });
});
