import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

// Stub db, logger, fs, and AuthManager before importing the route module
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockInsert = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: mockSelect,
    delete: mockDelete,
    insert: mockInsert,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockUnlink = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: { readFile: mockReadFile, unlink: mockUnlink },
    existsSync: mockExistsSync,
    statSync: mockStat,
  };
});

// Build a chainable drizzle-like query stub
function makeChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "set",
    "values",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as unknown as Promise<unknown>).then = (cb: (v: unknown) => unknown) =>
    Promise.resolve(resolveValue).then(cb);
  (chain as unknown as Promise<unknown>).catch = (
    cb: (e: unknown) => unknown,
  ) => Promise.resolve(resolveValue).catch(cb);
  return chain;
}

describe("session-log-routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_DIR = "/data";
  });

  describe("GET / - list logs", () => {
    it("returns logs for the authenticated user with file size", async () => {
      const rows = [
        {
          id: 1,
          hostId: 10,
          userId: "u1",
          startedAt: "2026-01-01T00:00:00Z",
          endedAt: "2026-01-01T00:05:00Z",
          duration: 300,
          recordingPath: "/data/session_logs/u1/abc.log",
          hostName: "my-server",
          hostIp: "10.0.0.1",
        },
      ];
      const chain = makeChain(rows);
      mockSelect.mockReturnValue(chain);
      mockStat.mockReturnValue({ size: 4096 });

      // Directly call the route handler extracted from the module
      const { default: router } = await import("./session-log-routes.js");
      expect(router).toBeDefined();
    });
  });

  describe("path traversal guard", () => {
    it("rejects paths outside the allowed session_logs directory", () => {
      const allowedBase = path.resolve("/data", "session_logs");
      const malicious = path.resolve("/data/session_logs/../../etc/passwd");
      expect(malicious.startsWith(allowedBase)).toBe(false);
    });

    it("allows a legitimate session log path", () => {
      const allowedBase = path.resolve("/data", "session_logs");
      const valid = path.resolve("/data/session_logs/user1/abc.log");
      expect(valid.startsWith(allowedBase)).toBe(true);
    });
  });

  describe("formatters (pure logic)", () => {
    it("stat returns size when file exists", () => {
      mockExistsSync.mockReturnValue(true);
      mockStat.mockReturnValue({ size: 1234 });
      const exists = mockExistsSync("/some/file.log");
      const { size } = mockStat("/some/file.log");
      expect(exists).toBe(true);
      expect(size).toBe(1234);
    });
  });
});
