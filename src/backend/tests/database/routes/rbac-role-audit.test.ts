import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => {}) }));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: audit.logAudit,
  getAuditUsername: async () => "root",
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: { userId?: string }, _res: unknown, next: () => void) => {
          req.userId = "admin-1";
          next();
        },
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  SHARE_PERMISSION_LEVELS: ["connect", "view", "edit", "manage"],
  PermissionManager: {
    getInstance: () => ({
      requirePermission:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
      requireAdmin: () => (_req: unknown, _res: unknown, next: () => void) =>
        next(),
      invalidateUserPermissionCache: vi.fn(),
      isAdmin: async () => true,
    }),
  },
}));

const role = { id: 7, name: "ops", displayName: "Ops", isSystem: false };

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentRoleRepository: () => ({
    findRoleByName: async () => null,
    createRole: async () => 7,
    findRoleById: async () => role,
    updateRole: async () => undefined,
    listRoleUserIds: async () => ["u2"],
    deleteRole: async () => ({ deletedUserIds: ["u2"] }),
    findUserRole: async () => null,
    assignRoleToUser: async () => undefined,
    removeRoleFromUser: async () => undefined,
    listUserRoleIds: async () => [],
  }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ id: "u2", username: "bob" }),
  }),
  createCurrentRbacAccessRepository: () => ({
    listHostIdsGrantedBy: async () => [],
  }),
  createCurrentCredentialAccessRepository: () => ({
    listCredentialIdsGrantedBy: async () => [],
  }),
  createCurrentSharedHostSecretsRepository: () => ({
    deleteForRoleMember: async () => undefined,
  }),
  createCurrentSharedCredentialSecretsRepository: () => ({
    deleteForRoleMember: async () => undefined,
  }),
}));

vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForRoleMember: async () => undefined }),
  },
}));
vi.mock("../../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForRoleMember: async () => undefined }),
  },
}));

const { default: rbacRouter } =
  await import("../../../database/routes/rbac.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/rbac", rbacRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => audit.logAudit.mockClear());

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/rbac${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function lastAudit() {
  const calls = audit.logAudit.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[calls.length - 1]?.[0];
}

describe("role changes are audited", () => {
  it("on create", async () => {
    const res = await call("POST", "/roles", {
      name: "ops",
      displayName: "Ops",
    });
    expect(res.status).toBe(201);
    expect(lastAudit()).toMatchObject({
      action: "create_role",
      resourceType: "role",
      resourceId: "7",
      resourceName: "ops",
      userId: "admin-1",
    });
  });

  it("on a permission change, naming the permissions", async () => {
    const res = await call("PUT", "/roles/7", {
      permissions: ["admin.users.manage"],
    });
    expect(res.status).toBe(200);
    expect(lastAudit()).toMatchObject({ action: "update_role" });
    expect(JSON.parse(String(lastAudit()?.details))).toEqual({
      permissions: ["admin.users.manage"],
    });
  });

  it("on delete", async () => {
    expect((await call("DELETE", "/roles/7")).status).toBe(200);
    expect(lastAudit()).toMatchObject({ action: "delete_role" });
  });

  it("on assign and remove", async () => {
    expect((await call("POST", "/users/u2/roles", { roleId: 7 })).status).toBe(
      200,
    );
    expect(lastAudit()).toMatchObject({
      action: "assign_role",
      details: JSON.stringify({ targetUserId: "u2" }),
    });
    expect((await call("DELETE", "/users/u2/roles/7")).status).toBe(200);
    expect(lastAudit()).toMatchObject({ action: "remove_role" });
  });
});
