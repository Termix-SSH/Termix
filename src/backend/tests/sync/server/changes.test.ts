import { beforeEach, expect, it, vi } from "vitest";

const { listChanges } = vi.hoisted(() => ({ listChanges: vi.fn() }));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ createAuthMiddleware: () => vi.fn() }) },
}));
vi.mock("../../../utils/logger.js", () => ({ syncLogger: { error: vi.fn() } }));
vi.mock("../../../utils/app-version.js", () => ({ getLocalVersion: vi.fn() }));
vi.mock("../../../plugins/index.js", () => ({ getPluginRuntime: vi.fn() }));
vi.mock("../../../plugins/sync-registry.js", () => ({
  getEntity: vi.fn(),
  listEntities: () => [{ type: "hosts", owner: "core", order: 10 }],
}));
vi.mock("../../../database/repositories/factory.js", () => ({}));
vi.mock("../../../sync/entities.js", () => ({
  registerCoreSyncEntities: vi.fn(),
}));
vi.mock("../../../sync/records.js", () => ({
  listChanges,
  recordKey: vi.fn(),
}));
vi.mock("../../../sync/server/feed.js", () => ({
  withUserLock: (_userId: string, fn: () => unknown) => fn(),
  reconcileUser: async () => ({ wire: new Map() }),
}));
vi.mock("../../../sync/server/push.js", () => ({}));
vi.mock("../../../database/routes/branding-settings.js", () => ({}));

import router from "../../../sync/server/routes.js";

const route = router.stack.find(
  (layer) => layer.route?.path === "/v2/changes",
)!.route!;
const handler = route.stack[route.stack.length - 1].handle;

beforeEach(() => {
  vi.clearAllMocks();
  listChanges.mockResolvedValue([]);
});

async function changes(query: Record<string, string>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ userId: "user-1", query } as never, res as never, vi.fn());
  return res;
}

it("answers an empty page with the entity types past the newest change", async () => {
  const cursor = String(Number.MAX_SAFE_INTEGER);
  const res = await changes({ cursor, limit: "1000" });
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({
    changes: [],
    nextCursor: Number.MAX_SAFE_INTEGER,
    hasMore: false,
    entityTypes: [{ type: "hosts", owner: "core", order: 10, readOnly: false }],
  });
});

it("defaults a missing cursor and limit", async () => {
  await changes({});
  expect(listChanges).toHaveBeenCalledWith("user-1", 0, 1001, undefined);
});

it.each([
  { cursor: "abc" },
  { cursor: "-1" },
  { cursor: "1.5" },
  { cursor: "Infinity" },
  { limit: "1.5" },
  { limit: "-5" },
])("rejects a malformed query %o", async (query) => {
  const res = await changes(query);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(listChanges).not.toHaveBeenCalled();
});
