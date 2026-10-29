import express from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  access: {
    hasAccess: true,
    isShared: true,
    isAdminBypass: false,
  },
  credentialUsable: true,
  credentialId: 7 as number | null,
  writes: [] as Array<{ protocol: string; credentialId: number | null }>,
  folderWrites: [] as Array<{
    folder: string;
    protocol: string;
    credentialId: number | null;
  }>,
  auditCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request & { userId?: string },
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (!state.authenticated) {
            res.status(401).json({ error: "Not authenticated" });
            return;
          }
          req.userId = "recipient";
          next();
        },
      createDataAccessMiddleware:
        () =>
        (
          _req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) =>
          next(),
    }),
  },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  SHARE_PERMISSION_LEVELS: ["connect", "view", "edit", "manage"],
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => state.access,
      requirePermission:
        () =>
        (
          _req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) =>
          next(),
      requireAdmin:
        () =>
        (
          _req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) =>
          next(),
      invalidateUserPermissionCache: vi.fn(),
      isAdmin: async () => false,
    }),
  },
}));

vi.mock("../../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (credentialId: number) =>
    state.credentialUsable ? { id: credentialId } : null,
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSharedHostAuthOverrideRepository: () => ({
    findCredentialId: async () => state.credentialId,
    setCredential: async (
      _hostId: number,
      _userId: string,
      protocol: string,
      id: number,
    ) => {
      state.credentialId = id;
      state.writes.push({ protocol, credentialId: id });
    },
    clearCredential: async (
      _hostId: number,
      _userId: string,
      protocol: string,
    ) => {
      state.credentialId = null;
      state.writes.push({ protocol, credentialId: null });
      return true;
    },
  }),
  createCurrentSharedFolderAuthOverrideRepository: () => ({
    findCredentialId: async () => 7,
    setCredential: async (
      _userId: string,
      folder: string,
      protocol: string,
      credentialId: number,
    ) => {
      state.folderWrites.push({ folder, protocol, credentialId });
    },
    clearCredential: async (
      _userId: string,
      folder: string,
      protocol: string,
    ) => {
      state.folderWrites.push({ folder, protocol, credentialId: null });
      return true;
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ id: "recipient", username: "recipient" }),
  }),
  createCurrentHostFolderRepository: vi.fn(),
  createCurrentHostResolutionRepository: vi.fn(),
  createCurrentRbacAccessRepository: vi.fn(),
  createCurrentRoleRepository: vi.fn(),
  createCurrentSnippetRepository: vi.fn(),
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  getRequestMeta: () => ({ ipAddress: "", userAgent: "" }),
  getAuditUsername: async (userId: string) => userId,
  logAudit: vi.fn(async (entry: Record<string, unknown>) => {
    state.auditCalls.push(entry);
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("shared host authentication override routes", () => {
  let router: express.Router;

  beforeAll(async () => {
    ({ default: router } = await import("../../../database/routes/rbac.js"));
  });

  async function invoke(
    method: "get" | "put",
    body: Record<string, unknown> = {},
    protocol = "ssh",
    path = "/host-access/:hostId/auth/:protocol",
    query: Record<string, unknown> = {},
  ): Promise<{ status: number; body: unknown }> {
    const routeLayer = (
      router as unknown as {
        stack: Array<{
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{
              handle: (
                req: express.Request,
                res: express.Response,
                next: express.NextFunction,
              ) => unknown;
            }>;
          };
        }>;
      }
    ).stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method],
    );
    if (!routeLayer?.route) throw new Error(`Missing ${method} route`);

    const handlers = routeLayer.route.stack.map((layer) => layer.handle);
    const req = {
      params: { hostId: "42", protocol },
      query,
      body,
      headers: {},
      ip: "127.0.0.1",
    } as unknown as express.Request;

    return new Promise((resolve, reject) => {
      let index = 0;
      let status = 200;
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json(responseBody: unknown) {
          resolve({ status, body: responseBody });
          return this;
        },
      } as unknown as express.Response;

      const next: express.NextFunction = (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        const handler = handlers[index++];
        if (!handler) {
          resolve({ status, body: undefined });
          return;
        }
        try {
          Promise.resolve(handler(req, res, next)).catch(reject);
        } catch (handlerError) {
          reject(handlerError);
        }
      };
      next();
    });
  }

  beforeEach(() => {
    state.authenticated = true;
    state.access = {
      hasAccess: true,
      isShared: true,
      isAdminBypass: false,
    };
    state.credentialUsable = true;
    state.credentialId = 7;
    state.writes = [];
    state.folderWrites = [];
    state.auditCalls = [];
  });

  describe("folder logins", () => {
    const FOLDER = "/folder-auth/:protocol";

    it("reads the login for a folder", async () => {
      const response = await invoke("get", {}, "ssh", FOLDER, {
        folder: " Prod /  Web ",
      });
      expect(response).toEqual({
        status: 200,
        body: { folder: "Prod / Web", protocol: "ssh", credentialId: 7 },
      });
    });

    it("sets and clears the login and audits both", async () => {
      expect(
        (
          await invoke(
            "put",
            { folder: "Prod", credentialId: 8 },
            "ssh",
            FOLDER,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await invoke(
            "put",
            { folder: "Prod", credentialId: null },
            "ssh",
            FOLDER,
          )
        ).status,
      ).toBe(200);
      expect(state.folderWrites).toEqual([
        { folder: "Prod", protocol: "ssh", credentialId: 8 },
        { folder: "Prod", protocol: "ssh", credentialId: null },
      ]);
      expect(state.auditCalls.map((call) => call.action)).toEqual([
        "set_shared_folder_auth_override",
        "clear_shared_folder_auth_override",
      ]);
    });

    it("rejects a bad folder, protocol or credential", async () => {
      expect(
        (await invoke("get", {}, "ssh", FOLDER, { folder: "" })).status,
      ).toBe(400);
      expect(
        (
          await invoke(
            "put",
            { folder: "x".repeat(300), credentialId: 8 },
            "ssh",
            FOLDER,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await invoke(
            "put",
            { folder: "Prod", credentialId: 8 },
            "smtp",
            FOLDER,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await invoke(
            "put",
            { folder: "Prod", credentialId: -1 },
            "ssh",
            FOLDER,
          )
        ).status,
      ).toBe(400);
      state.credentialUsable = false;
      expect(
        (
          await invoke(
            "put",
            { folder: "Prod", credentialId: 99 },
            "ssh",
            FOLDER,
          )
        ).status,
      ).toBe(404);
      expect(state.folderWrites).toEqual([]);
    });
  });

  it("returns the current override for a role-derived shared recipient", async () => {
    const response = await invoke("get");
    expect(response).toEqual({
      status: 200,
      body: { protocol: "ssh", credentialId: 7 },
    });
  });

  it("sets and clears a direct recipient's own credential", async () => {
    const setResponse = await invoke("put", { credentialId: 8 });
    expect(setResponse.status).toBe(200);
    expect(state.writes).toEqual([{ protocol: "ssh", credentialId: 8 }]);

    const clearResponse = await invoke("put", { credentialId: null });
    expect(clearResponse.status).toBe(200);
    expect(state.writes).toEqual([
      { protocol: "ssh", credentialId: 8 },
      { protocol: "ssh", credentialId: null },
    ]);
    expect(state.auditCalls).toHaveLength(2);
    expect(JSON.parse(String(state.auditCalls[0].details))).toEqual({
      protocol: "ssh",
      credentialId: 8,
    });
  });

  it("rejects owners, admin bypasses, and users without active access", async () => {
    for (const access of [
      { hasAccess: true, isShared: false, isAdminBypass: false },
      { hasAccess: true, isShared: false, isAdminBypass: true },
      { hasAccess: false, isShared: true, isAdminBypass: false },
    ]) {
      state.access = access;
      const response = await invoke("get");
      expect(response.status).toBe(403);
    }
  });

  it("rejects invalid or foreign credentials and unauthenticated requests", async () => {
    const invalidResponse = await invoke("put", { credentialId: 0 });
    expect(invalidResponse.status).toBe(400);

    state.credentialUsable = false;
    const foreignResponse = await invoke("put", { credentialId: 99 });
    expect(foreignResponse.status).toBe(404);

    state.authenticated = false;
    const unauthenticatedResponse = await invoke("get");
    expect(unauthenticatedResponse.status).toBe(401);
  });

  it("serves any protocol a plugin declares and rejects the rest", async () => {
    const { setHostProtocolSource } =
      await import("../../../hosts/protocol-auth/registry.js");
    setHostProtocolSource(() => [
      { id: "spice", pluginId: "spice-plugin", pluginName: "Spice" },
    ]);
    const declared = await invoke("get", {}, "spice");
    setHostProtocolSource(() => []);
    expect(declared.status).toBe(200);
    expect(declared.body.protocol).toBe("spice");
    expect(state.writes).toEqual([]);

    const undeclared = await invoke("get", {}, "spice");
    expect(undeclared.status).toBe(400);

    const invalidResponse = await invoke("get", {}, "smtp");
    expect(invalidResponse).toEqual({
      status: 400,
      body: { error: "Invalid authentication protocol" },
    });
  });
});
