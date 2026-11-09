import { afterEach, describe, expect, it, vi } from "vitest";

import { clearStepUp, recordStepUp } from "../../auth/step-up.js";

const logAudit = vi.fn();
vi.mock("../../utils/logger.js", () => ({
  pluginLogger: { warn: vi.fn() },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: (params: unknown) => logAudit(params),
  getAuditUsername: async (userId: string) => `name-${userId}`,
}));

const {
  assertConnectAllowed,
  clearConnectPolicies,
  ConnectPolicyError,
  evaluateConnectPolicy,
  hasConnectPolicies,
  provideConnectPolicy,
} = await import("../../hosts/connect-policy.js");

const input = {
  userId: "u1",
  hostId: 4,
  protocol: "ssh",
  purpose: "terminal",
  profile: "terminal",
  interactive: true,
  origin: "ssh-terminal",
};

afterEach(() => {
  clearConnectPolicies();
  logAudit.mockReset();
});

describe("connect policy", () => {
  it("allows with no provider", async () => {
    expect(hasConnectPolicies()).toBe(false);
    await expect(assertConnectAllowed(input)).resolves.toBeUndefined();
    expect(await evaluateConnectPolicy(input)).toEqual({ decision: "allow" });
  });

  it("passes the input to the provider", async () => {
    const check = vi.fn(() => ({ decision: "allow" as const }));
    provideConnectPolicy("p", { check });
    await assertConnectAllowed(input);
    expect(check).toHaveBeenCalledWith({ ...input, stepUpAt: null });
  });

  it("tells the provider when the user last proved a second factor", async () => {
    const check = vi.fn(() => ({ decision: "allow" as const }));
    provideConnectPolicy("p", { check });
    recordStepUp(input.userId, 1234);
    await assertConnectAllowed(input);
    clearStepUp(input.userId);
    expect(check).toHaveBeenCalledWith({ ...input, stepUpAt: 1234 });
  });

  it("keeps a verify request, so clients can say Verify", async () => {
    provideConnectPolicy("p", {
      check: () => ({
        decision: "request",
        requestTab: "verify-tab",
        requestKind: "verify",
      }),
    });
    await expect(assertConnectAllowed(input)).rejects.toMatchObject({
      result: { requestKind: "verify", requestTab: "verify-tab" },
    });
  });

  it("picks the strictest answer", async () => {
    provideConnectPolicy("a", {
      check: () => ({ decision: "request", reason: "ask", requestTab: "pa" }),
    });
    provideConnectPolicy("b", { check: () => ({ decision: "allow" }) });
    expect(await evaluateConnectPolicy(input)).toEqual({
      decision: "request",
      reason: "ask",
      pluginId: "a",
      requestTab: "pa",
    });
    provideConnectPolicy("c", {
      check: async () => ({ decision: "deny", reason: "no" }),
    });
    const result = await evaluateConnectPolicy(input);
    expect(result).toMatchObject({ decision: "deny", pluginId: "c" });
  });

  it("denies when a provider throws", async () => {
    provideConnectPolicy("broken", {
      check: () => {
        throw new Error("boom");
      },
    });
    expect(await evaluateConnectPolicy(input)).toMatchObject({
      decision: "deny",
      pluginId: "broken",
    });
  });

  it("throws a typed error and audits the refusal", async () => {
    provideConnectPolicy("pa", {
      check: () => ({ decision: "request", requestTab: "access" }),
    });
    const error = await assertConnectAllowed(input).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectPolicyError);
    expect(error.code).toBe("access-required");
    expect(error.status).toBe(403);
    expect(error.toJSON()).toEqual({
      error: "This host needs approved access",
      code: "access-required",
      requestTab: "access",
      pluginId: "pa",
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "connect_policy_denied",
        userId: "u1",
        username: "name-u1",
        resourceId: "4",
        success: false,
      }),
    );
  });

  it("drops a request tab that is not a plain id", async () => {
    provideConnectPolicy("pa", {
      check: () => ({ decision: "request", requestTab: "../x y" }),
    });
    expect(await evaluateConnectPolicy(input)).toMatchObject({
      requestTab: null,
    });
  });

  it("stops asking once removed", async () => {
    const remove = provideConnectPolicy("pa", {
      check: () => ({ decision: "deny" }),
    });
    remove();
    await expect(assertConnectAllowed(input)).resolves.toBeUndefined();
  });
});
