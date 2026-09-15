import express, {
  type RequestHandler,
  type Response,
  type Router,
} from "express";
import { describe, expect, it, vi } from "vitest";

import { registerCredentialBulkRoutes } from "../../../database/routes/credential-bulk-routes.js";

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCredentialRepository: () => ({
    reorderForUser: vi.fn(),
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { error: vi.fn() },
}));

function reorderHandlers(router: Router): RequestHandler[] {
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/reorder" && entry.route.methods.put,
  );
  if (!layer?.route) throw new Error("PUT /reorder was not registered");
  return layer.route.stack.map((entry) => entry.handle);
}

describe("credential reorder route", () => {
  it("stops before data access when credentials.edit is denied", async () => {
    const router = express.Router();
    const authenticate: RequestHandler = (req, _res, next) => {
      Object.assign(req, { userId: "user-1" });
      next();
    };
    const requireEdit: RequestHandler = (_req, res) => {
      res.status(403).json({
        error: "Insufficient permissions",
        required: "credentials.edit",
      });
    };
    const requireDataAccess = vi.fn((_req, _res, next) => next());

    registerCredentialBulkRoutes(
      router,
      authenticate,
      requireEdit,
      requireDataAccess,
    );

    const response = {} as Response;
    const status = vi.fn(() => response);
    const json = vi.fn(() => response);
    Object.assign(response, { status, json });
    const request = { body: { positions: [{ id: 1, sortOrder: 0 }] } };

    for (const handler of reorderHandlers(router)) {
      let continued = false;
      await handler(request as never, response, () => {
        continued = true;
      });
      if (!continued) break;
    }

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: "Insufficient permissions",
      required: "credentials.edit",
    });
    expect(requireDataAccess).not.toHaveBeenCalled();
  });
});
