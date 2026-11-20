import { afterEach, describe, expect, it } from "vitest";
import {
  clearConnectPolicies,
  probeAllowedHostIds,
  provideConnectPolicy,
} from "../../hosts/connect-policy.js";

afterEach(clearConnectPolicies);

describe("probe policies", () => {
  it("allows every host with no probe provider, even if others deny", async () => {
    provideConnectPolicy("jit", {
      check: () => ({ decision: "deny", reason: "x" }),
    });
    expect([...(await probeAllowedHostIds("u", [1, 2]))]).toEqual([1, 2]);
  });

  it("leaves out hosts a probe provider denies or fails on", async () => {
    provideConnectPolicy("sleep", {
      probes: true,
      check: (input) => {
        expect(input.profile).toBe("probe");
        if (input.hostId === 2) throw new Error("broken");
        return input.hostId === 3
          ? { decision: "deny", reason: "asleep" }
          : { decision: "allow" };
      },
    });
    expect([...(await probeAllowedHostIds("u", [1, 2, 3]))]).toEqual([1]);
  });
});
