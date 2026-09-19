import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import { databaseLogger } from "../../../utils/logger.js";

const state = vi.hoisted(() => ({
  userId: "user-1",
  settings: {} as Record<string, string>,
  sessions: [] as unknown[],
}));

// Reproduces a package that shipped without the native binary for the running
// architecture: importing sharp throws instead of resolving.
vi.mock("sharp", () => {
  throw new Error(
    'Could not load the "sharp" module using the darwin-x64 runtime',
  );
});

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

vi.mock("../../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {
    getUserSessions: () => state.sessions,
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings[key] ?? null,
  }),
  createCurrentHostResolutionRepository: () => ({}),
  createCurrentCommandHistoryRepository: () => ({}),
}));

const { default: router } =
  await import("../../../database/routes/terminal.js");

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

const imageUploadLayer = (
  router as unknown as { stack: RouteLayer[] }
).stack.find(
  (layer) => layer.route?.path === "/image-upload" && layer.route.methods.post,
);
const imageUploadHandler =
  imageUploadLayer!.route!.stack[imageUploadLayer!.route!.stack.length - 1]!
    .handle;

async function invoke() {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const req = {
    userId: state.userId,
    body: { instanceId: "tab-1" },
    file: { buffer, mimetype: "image/png", size: buffer.length },
    headers: {},
  } as unknown as Request;
  const result = { statusCode: 200, body: null as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;
  await imageUploadHandler(req, res, () => {});
  return result;
}

beforeEach(() => {
  vi.mocked(databaseLogger.error).mockClear();
  state.settings = { terminal_image_storage_mode: "remote-sftp" };
  state.sessions = [{ tabInstanceId: "tab-1", isConnected: true, sshConn: {} }];
});

describe("terminal image upload route when sharp cannot be loaded", () => {
  it("imports the router instead of failing at module scope", () => {
    expect(imageUploadHandler).toBeTypeOf("function");
  });

  it("answers 503 and logs the reason rather than throwing", async () => {
    const response = await invoke();

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      code: "IMAGE_PROCESSING_UNAVAILABLE",
    });
    expect(databaseLogger.error).toHaveBeenCalledWith(
      "Image processing unavailable: sharp failed to load",
      expect.anything(),
      expect.objectContaining({
        operation: "terminal_image_upload_sharp_unavailable",
      }),
    );
  });

  it("keeps answering 503 on later uploads without retrying the import", async () => {
    await invoke();
    const response = await invoke();

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      code: "IMAGE_PROCESSING_UNAVAILABLE",
    });
  });
});
