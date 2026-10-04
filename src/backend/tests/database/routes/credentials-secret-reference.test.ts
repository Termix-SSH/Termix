/**
 * A key credential whose private key is a secret reference (op://...) is
 * saved as given and resolved when connecting (#1394). Parsing the reference
 * as a key used to reject it, and an update kept the old private key.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  existing: null as Record<string, unknown> | null,
}));

const pass = (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: { userId?: string }, _res: unknown, next: () => void) => {
          req.userId = "u1";
          next();
        },
      createDataAccessMiddleware: () => pass,
    }),
  },
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ requirePermission: () => pass }),
  },
}));
vi.mock("../../../sync/shared-copy-guard.js", () => ({
  rejectSharedCopyWrites: () => pass,
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async () => {},
  getAuditUsername: async () => "u1",
  getRequestMeta: () => ({ ipAddress: null, userAgent: null }),
}));
vi.mock("../../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return { authLogger: log, sshLogger: log, databaseLogger: log };
});
vi.mock("../../../database/routes/credential-key-routes.js", () => ({
  registerCredentialKeyRoutes: () => {},
}));
vi.mock("../../../database/routes/credential-deploy-routes.js", () => ({
  registerCredentialDeployRoutes: () => {},
}));
vi.mock("../../../database/routes/credential-bulk-routes.js", () => ({
  registerCredentialBulkRoutes: () => {},
}));
vi.mock("../../../hosts/delete-credential.js", () => ({
  deleteOwnedCredential: async () => {},
}));
vi.mock("../../../hosts/connect/core-providers.js", () => ({
  ensureCoreSshAuthProviders: () => {},
}));
vi.mock("../../../hosts/connect/auth-provider-registry.js", () => ({
  listCredentialTypes: () => ["password", "key"],
}));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ resyncHostsForCredential: async () => {} }),
  },
}));
vi.mock("../../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ resyncCredential: async () => {} }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCredentialRepository: () => ({
    createEncryptedForUser: async (
      userId: string,
      data: Record<string, unknown>,
    ) => {
      h.created.push(data);
      return { id: 1, userId, ...data };
    },
    findById: async () => (h.existing ? { id: 1, userId: "u1" } : null),
    findDecryptedByIdForUser: async () => h.existing,
    updateEncryptedForUser: async (
      _userId: string,
      _id: number,
      fields: Record<string, unknown>,
    ) => {
      h.updated.push(fields);
      return { ...h.existing, ...fields };
    },
  }),
  createCurrentUserRepository: () => ({}),
  createCurrentCredentialAccessRepository: () => ({}),
  createCurrentRoleRepository: () => ({}),
  createCurrentHostResolutionRepository: () => ({}),
  createCurrentHostRepository: () => ({}),
}));

const { default: router } =
  await import("../../../database/routes/credentials.js");

// Never parsed here: only the update replacing it matters.
const REAL_KEY = "stored-key-material";

let server: http.Server;
let base: string;

beforeEach(async () => {
  h.created = [];
  h.updated = [];
  h.existing = null;
  const app = express();
  app.use(express.json());
  app.use("/credentials", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(method: string, path: string, body: unknown) {
  return fetch(`${base}/credentials${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("credentials with a secret reference key", () => {
  it("saves an op:// private key as given", async () => {
    const response = await send("POST", "", {
      name: "vault key",
      authType: "key",
      username: "root",
      key: "op://vault/item/private_key",
    });

    expect(response.status).toBe(201);
    expect(h.created[0]).toMatchObject({
      key: "op://vault/item/private_key",
      privateKey: "op://vault/item/private_key",
      publicKey: null,
      detectedKeyType: null,
    });
  });

  it("still rejects a key that is neither a key nor a reference", async () => {
    const response = await send("POST", "", {
      name: "bad",
      authType: "key",
      key: "not a key",
    });
    expect(response.status).toBe(400);
  });

  it("replaces the stored private key when updating to a reference", async () => {
    h.existing = {
      id: 1,
      userId: "u1",
      name: "k",
      authType: "key",
      key: REAL_KEY,
      privateKey: REAL_KEY,
      publicKey: "ssh-ed25519 AAAA old",
    };

    const response = await send("PUT", "/1", {
      key: "op://vault/item/private_key",
    });

    expect(response.status).toBe(200);
    expect(h.updated[0]).toMatchObject({
      key: "op://vault/item/private_key",
      privateKey: "op://vault/item/private_key",
      publicKey: null,
      detectedKeyType: null,
    });
  });
});
