import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn() },
}));

const {
  clearAuthPolicies,
  evaluateAuthPolicy,
  hasAuthPolicies,
  provideAuthPolicy,
  rememberDeviceAllowed,
} = await import("../../auth/policy.js");

const input = {
  userId: "u1",
  methodId: "password",
  external: false,
  deviceType: "web" as const,
  trustedDevice: false,
  mfaSatisfied: false,
  secondFactors: [],
};

beforeEach(() => clearAuthPolicies());

describe("auth policy", () => {
  it("changes nothing without a provider", async () => {
    expect(hasAuthPolicies()).toBe(false);
    expect(await evaluateAuthPolicy(input)).toEqual({
      allowRememberDevice: true,
      maxSessionSeconds: null,
      idleTimeoutSeconds: null,
      secondFactor: null,
    });
    expect(rememberDeviceAllowed()).toBe(true);
  });

  it("takes the strictest answer from every provider", async () => {
    provideAuthPolicy("a", {
      evaluate: () => ({
        maxSessionSeconds: 3600,
        idleTimeoutSeconds: 900,
        secondFactor: "new-device",
      }),
    });
    provideAuthPolicy("b", {
      evaluate: async () => ({
        allowRememberDevice: false,
        maxSessionSeconds: 7200,
        idleTimeoutSeconds: 300,
        secondFactor: "always",
      }),
      allowRememberDevice: () => false,
    });
    expect(await evaluateAuthPolicy(input)).toEqual({
      allowRememberDevice: false,
      maxSessionSeconds: 3600,
      idleTimeoutSeconds: 300,
      secondFactor: "always",
    });
    expect(rememberDeviceAllowed()).toBe(false);
  });

  it("ignores zero and negative limits", async () => {
    provideAuthPolicy("a", {
      evaluate: () => ({ maxSessionSeconds: 0, idleTimeoutSeconds: -5 }),
    });
    expect(await evaluateAuthPolicy(input)).toMatchObject({
      maxSessionSeconds: null,
      idleTimeoutSeconds: null,
    });
  });

  it("refuses the login when a provider throws, until it is removed", async () => {
    const remove = provideAuthPolicy("a", {
      evaluate: () => {
        throw new Error("boom");
      },
    });
    await expect(evaluateAuthPolicy(input)).rejects.toMatchObject({
      status: 503,
      code: "auth_policy_unavailable",
    });
    remove();
    await expect(evaluateAuthPolicy(input)).resolves.toMatchObject({
      secondFactor: null,
    });
  });

  it("hides remember me when the hint throws", () => {
    provideAuthPolicy("a", {
      evaluate: () => ({}),
      allowRememberDevice: () => {
        throw new Error("boom");
      },
    });
    expect(rememberDeviceAllowed()).toBe(false);
  });
});
