/**
 * A failed login or reset must not tell whether the username exists: same
 * status, same message and a password hash check on every path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
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

vi.mock("../../plugins/activity-provider.js", () => ({
  recentActivity: { deleteByUserId: vi.fn() },
}));

const express = (await import("express")).default;
const request = (await import("supertest")).default;
const { verifyPasswordLogin } =
  await import("../../auth/builtin-login-methods.js");
const { loginRateLimiter } = await import("../../utils/login-rate-limiter.js");
const { registerUserPasswordResetRoutes } =
  await import("../../database/routes/user-password-reset-routes.js");

const PASSWORD = "correct-horse";

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.trustedProxy = false;
  delete process.env.ALLOW_PASSWORD_LOGIN;
  delete process.env.ALLOW_PASSWORD_RESET;
  for (const name of ["alice", "nobody", "sso-only"])
    loginRateLimiter.resetAttempts("10.0.0.1", name);
  h.state.users.set("u1", {
    id: "u1",
    username: "alice",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isAdmin: false,
  });
  h.state.users.set("u2", {
    id: "u2",
    username: "sso-only",
    passwordHash: "",
    isAdmin: false,
  });
  h.state.identities.push({
    id: 1,
    userId: "u2",
    providerId: "oidc",
    subject: "s",
    email: null,
  });
});

async function failure(username: string) {
  const compare = vi.spyOn(bcrypt, "compare");
  try {
    const error = await verifyPasswordLogin(
      fakeRequest({ body: { username, password: "wrong" } }) as never,
    ).then(
      () => null,
      (e: { status: number; message: string }) => e,
    );
    return { error, compared: compare.mock.calls.length };
  } finally {
    compare.mockRestore();
  }
}

describe("GHSA-vwmj-3m3c-h2r2 usernames stay hidden", () => {
  it("answers an unknown user like a wrong password, after a hash check", async () => {
    const wrong = await failure("alice");
    const unknown = await failure("nobody");
    expect(wrong.error).toMatchObject({ status: 401 });
    expect(unknown.error).toMatchObject({
      status: wrong.error!.status,
      message: wrong.error!.message,
    });
    expect(unknown.compared).toBe(1);
  });

  it("answers an SSO only user like a wrong password", async () => {
    const wrong = await failure("alice");
    const sso = await failure("sso-only");
    expect(sso.error).toMatchObject({
      status: wrong.error!.status,
      message: wrong.error!.message,
    });
    expect(sso.compared).toBe(1);
  });

  it("gives the same reset answer for known, unknown and SSO users", async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerUserPasswordResetRoutes(router, { authManager: {} as never });
    app.use("/users", router);
    const bodies = [];
    for (const username of ["alice", "nobody", "sso-only"]) {
      const res = await request(app)
        .post("/users/initiate-reset")
        .send({ username });
      expect(res.status).toBe(200);
      bodies.push(res.body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(h.state.settings.has("reset_code_alice")).toBe(true);
  });
});
