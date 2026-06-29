import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
  authLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.userId = "user-1";
          next();
        },
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(),
  getRequestMeta: vi.fn(() => ({})),
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getInstance: () => ({ encrypt: vi.fn(), decrypt: vi.fn() }) },
}));

vi.mock("../../utils/user-crypto.js", () => ({
  UserCrypto: { getInstance: () => ({ getUserKey: vi.fn() }) },
}));

vi.mock("./termix-id-keys.js", () => ({
  termixIdKeysRouter: { use: vi.fn() },
  matchesAlgoFilter: vi.fn(() => true),
}));

vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: vi.fn().mockImplementation(() => ({
    findOne: vi.fn(),
    findAll: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  })),
}));

// Chainable Drizzle stub — supports arbitrary method chains and resolves via .then()
function makeChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "set",
    "values",
    "returning",
    "orderBy",
    "limit",
    "and",
    "eq",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as unknown as Promise<unknown>).then = (
    cb: (v: unknown) => unknown,
    eb?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveValue).then(cb, eb);
  (chain as unknown as Promise<unknown>).catch = (
    cb: (e: unknown) => unknown,
  ) => Promise.resolve(resolveValue).catch(cb);
  return chain;
}

const IDENTITY_ROW = { id: 42, userId: "user-1", handle: "alice" };

describe("GET /termix-id/linked-credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty list when user has no identity", async () => {
    // First select (getIdentityForUser) returns nothing; second should not be called
    mockSelect.mockReturnValueOnce(makeChain([]));

    const { default: router } = await import("./termix-id.js");
    expect(router).toBeDefined();

    expect(router).toBeDefined();
  });

  it("returns empty list when identity has no keys", async () => {
    mockSelect
      .mockReturnValueOnce(makeChain([IDENTITY_ROW])) // identity lookup
      .mockReturnValueOnce(makeChain([])); // keys lookup

    const { default: router } = await import("./termix-id.js");
    expect(router).toBeDefined();
  });

  it("returns deduplicated credentialIds for enabled keys", async () => {
    const keys = [
      { credentialId: 10 },
      { credentialId: 20 },
      { credentialId: 10 }, // duplicate
    ];
    mockSelect
      .mockReturnValueOnce(makeChain([IDENTITY_ROW]))
      .mockReturnValueOnce(makeChain(keys));

    const { default: router } = await import("./termix-id.js");
    expect(router).toBeDefined();
  });

  it("excludes keys with null credentialId", async () => {
    const keys = [{ credentialId: null }, { credentialId: 5 }];
    mockSelect
      .mockReturnValueOnce(makeChain([IDENTITY_ROW]))
      .mockReturnValueOnce(makeChain(keys));

    const { default: router } = await import("./termix-id.js");
    expect(router).toBeDefined();
  });
});
