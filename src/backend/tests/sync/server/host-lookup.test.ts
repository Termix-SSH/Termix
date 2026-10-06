import { beforeEach, expect, it, vi } from "vitest";

const { findHostIdBySyncId, canAccessHost } = vi.hoisted(() => ({
  findHostIdBySyncId: vi.fn(),
  canAccessHost: vi.fn(),
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ createAuthMiddleware: () => vi.fn() }) },
}));
vi.mock("../../../utils/logger.js", () => ({ syncLogger: { error: vi.fn() } }));
vi.mock("../../../utils/app-version.js", () => ({ getLocalVersion: vi.fn() }));
vi.mock("../../../plugins/index.js", () => ({ getPluginRuntime: vi.fn() }));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({ findHostIdBySyncId }),
  createCurrentHostRepository: () => ({
    findById: async () => ({ name: "Shared host" }),
  }),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ canAccessHost }) },
}));
vi.mock("../../../sync/entities.js", () => ({
  registerCoreSyncEntities: vi.fn(),
}));
vi.mock("../../../sync/records.js", () => ({}));
vi.mock("../../../sync/server/feed.js", () => ({}));
vi.mock("../../../sync/server/push.js", () => ({}));
vi.mock("../../../database/routes/branding-settings.js", () => ({}));

import router from "../../../sync/server/routes.js";

const route = router.stack.find(
  (layer) => layer.route?.path === "/v2/hosts/:syncId",
)!.route!;
const handler = route.stack[route.stack.length - 1].handle;

beforeEach(() => {
  vi.clearAllMocks();
  findHostIdBySyncId.mockResolvedValue(41);
  canAccessHost.mockImplementation(async (_user, _host, action) => ({
    hasAccess: action === "connect",
  }));
});

async function lookup() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(
    { userId: "recipient", params: { syncId: "host-sync-id" } } as never,
    res as never,
    vi.fn(),
  );
  return res;
}

it("resolves the server ID for a connect-only recipient", async () => {
  const res = await lookup();
  expect(findHostIdBySyncId).toHaveBeenCalledWith("host-sync-id");
  expect(canAccessHost).toHaveBeenCalledWith("recipient", 41, "connect");
  expect(res.json).toHaveBeenCalledWith({ id: 41, name: "Shared host" });
});

it("does not disclose a host the caller cannot connect to", async () => {
  canAccessHost.mockResolvedValue({ hasAccess: false });
  const res = await lookup();
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
});

it("returns 404 for a missing sync ID", async () => {
  findHostIdBySyncId.mockResolvedValue(null);
  const res = await lookup();
  expect(res.status).toHaveBeenCalledWith(404);
  expect(canAccessHost).not.toHaveBeenCalled();
});
