/**
 * The pending token from a password login finishes one login only. Sent
 * again with another valid code it must not start a second session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
  fakeResponse,
  type AuthState,
} from "./auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("./auth-test-helpers.js").fakeAuthManager
  >,
  trustedProxy: false,
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("./auth-test-helpers.js");
  const names = Object.keys(helpers.fakeFactory(helpers.createAuthState()));
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) =>
        (
          helpers.fakeFactory(h.state) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )[name](...args),
    ]),
  );
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => h.manager },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "test" }),
}));
vi.mock("../../hosts/internal-events.js", () => ({
  emitInternalEvent: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return {
    authLogger: log,
    databaseLogger: log,
    sshLogger: log,
    logger: log,
    systemLogger: log,
  };
});
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ invalidateUserPermissionCache: vi.fn() }),
  },
}));
vi.mock("../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => h.trustedProxy,
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));
vi.mock("../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));

const {
  respondWithLogin,
  verifySecondFactorAndRespond,
  resetPendingLoginsForTests,
} = await import("../../auth/login-pipeline.js");
const { verifyPasswordLogin } =
  await import("../../auth/builtin-login-methods.js");
const { registerSecondFactor } = await import("../../auth/registry.js");
const { loginRateLimiter } = await import("../../utils/login-rate-limiter.js");
const { clearAuthPolicies } = await import("../../auth/policy.js");

const PASSWORD = "correct-horse";
const CODES = new Set(["111111", "222222"]);
let dispose: (() => void) | null = null;

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.trustedProxy = false;
  resetPendingLoginsForTests();
  loginRateLimiter.resetAttempts("10.0.0.1", "alice");
  loginRateLimiter.resetTOTPAttempts("u1");
  clearAuthPolicies();
  dispose?.();
  dispose = registerSecondFactor({
    id: "totp",
    pluginId: "totp",
    labelKey: "totp:factor",
    isEnrolled: async () => false,
    verify: async (_userId, body) => CODES.has(String(body.totp_code)),
    reset: async () => {},
  });
  h.state.users.set("u1", {
    id: "u1",
    username: "alice",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isAdmin: false,
  });
  h.state.factors.push({ userId: "u1", pluginId: "totp", factorId: "totp" });
});

async function finish(tempToken: string, code: string) {
  const res = fakeResponse();
  await verifySecondFactorAndRespond(
    fakeRequest({ body: { temp_token: tempToken, totp_code: code } }) as never,
    res as never,
    "totp",
  );
  return res;
}

describe("GHSA-892r-827c-jphx pending login token is single use", () => {
  it("refuses a pending token that already finished a login", async () => {
    const req = fakeRequest({
      body: { username: "alice", password: PASSWORD },
    });
    const first = fakeResponse();
    await respondWithLogin(
      req as never,
      first as never,
      await verifyPasswordLogin(req as never),
      { methodId: "password", rememberMe: false },
    );
    const tempToken = (first.body as { temp_token: string }).temp_token;

    const ok = await finish(tempToken, "111111");
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === "jwt")).toBeDefined();

    const replay = await finish(tempToken, "222222");
    expect(replay.statusCode).toBe(401);
    expect(replay.cookies).toEqual([]);
  });
});
