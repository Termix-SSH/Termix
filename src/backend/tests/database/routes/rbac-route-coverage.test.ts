import express, { type RequestHandler, type Router } from "express";
import { describe, expect, it, vi } from "vitest";

import { registerHostBulkRoutes } from "../../../database/routes/host-bulk-routes.js";
import { registerHostFolderRoutes } from "../../../database/routes/host-folder-routes.js";

vi.mock("../../../database/repositories/factory.js", () => ({}));
vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), error: vi.fn() },
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const middleware = (): RequestHandler => (_req, _res, next) => next();

function handlers(router: Router, method: string, path: string) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods[method],
  );
  if (!layer?.route) throw new Error(`${method.toUpperCase()} ${path} missing`);
  return layer.route.stack.map((entry) => entry.handle);
}

describe("RBAC coverage for split host routers", () => {
  it("gates bulk mutations by action and data-access permissions", () => {
    const router = express.Router();
    const authenticate = middleware();
    const requireCreate = middleware();
    const requireEdit = middleware();
    const requireDataAccess = middleware();

    registerHostBulkRoutes(
      router,
      authenticate,
      requireCreate,
      requireEdit,
      requireDataAccess,
    );

    expect(handlers(router, "patch", "/bulk-update").slice(0, 3)).toEqual([
      authenticate,
      requireEdit,
      requireDataAccess,
    ]);
    expect(handlers(router, "put", "/reorder").slice(0, 3)).toEqual([
      authenticate,
      requireEdit,
      requireDataAccess,
    ]);
    for (const path of ["/bulk-import", "/ssh-config-import"]) {
      expect(handlers(router, "post", path).slice(0, 4)).toEqual([
        authenticate,
        requireCreate,
        requireEdit,
        requireDataAccess,
      ]);
    }
  });

  it("gates folder reads and mutations with their matching permissions", () => {
    const router = express.Router();
    const authenticate = middleware();
    const requireView = middleware();
    const requireEdit = middleware();
    const requireDelete = middleware();
    const requireCredentialEdit = middleware();
    const requireDataAccess = middleware();

    registerHostFolderRoutes(router, {
      authenticateJWT: authenticate,
      requireViewPermission: requireView,
      requireEditPermission: requireEdit,
      requireDeletePermission: requireDelete,
      requireCredentialEditPermission: requireCredentialEdit,
      requireDataAccess,
      statsServerUrl: "http://stats.invalid",
    });

    expect(handlers(router, "get", "/folders").slice(0, 3)).toEqual([
      authenticate,
      requireView,
      requireDataAccess,
    ]);
    expect(handlers(router, "put", "/folders/rename").slice(0, 4)).toEqual([
      authenticate,
      requireEdit,
      requireCredentialEdit,
      requireDataAccess,
    ]);
    for (const path of ["/folders/metadata", "/folders/reorder"]) {
      expect(handlers(router, "put", path).slice(0, 3)).toEqual([
        authenticate,
        requireEdit,
        requireDataAccess,
      ]);
    }
    expect(
      handlers(router, "delete", "/folders/:name/hosts").slice(0, 3),
    ).toEqual([authenticate, requireDelete, requireDataAccess]);
  });
});
