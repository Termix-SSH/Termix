import { describe, expect, it } from "vitest";
import {
  statusAfterAuthentication,
  statusAfterReachabilityCheck,
} from "./host-status.js";

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
