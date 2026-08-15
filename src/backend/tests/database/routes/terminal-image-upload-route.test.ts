import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import type { Request, RequestHandler, Response } from "express";
import type { ImageSftpClient } from "../../../database/routes/terminal-image-storage.js";

const state = vi.hoisted(() => ({
  userId: "user-1",
  settings: {} as Record<string, string>,
  sessions: [] as unknown[],
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
        next(),
      createDataAccessMiddleware: () => (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ) => next(),
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

const { default: router } = await import(
  "../../../database/routes/terminal.js"
);

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

const imageUploadLayer = (router as unknown as { stack: RouteLayer[] }).stack.find(
  (layer) => layer.route?.path === "/image-upload" && layer.route.methods.post,
);
const imageUploadHandler =
  imageUploadLayer!.route!.stack[imageUploadLayer!.route!.stack.length - 1]!
    .handle;

function fakeSftp(behavior: { writeError?: Error } = {}): {
  sftp: ImageSftpClient;
  written: Map<string, Buffer>;
  end: ReturnType<typeof vi.fn>;
} {
  const written = new Map<string, Buffer>();
  const end = vi.fn();
  const sftp = {
    mkdir: (
      _dir: string,
      attrsOrCallback: { mode?: number } | ((err?: Error) => void),
      maybeCallback?: (err?: Error) => void,
    ) => {
      const callback =
        typeof attrsOrCallback === "function"
          ? attrsOrCallback
          : maybeCallback!;
      callback();
    },
    createWriteStream: (remotePath: string, _options?: { mode?: number }) => {
      const stream = new EventEmitter() as NodeJS.WritableStream & {
        end: (data: Buffer) => void;
      };
      stream.end = (data: Buffer) => {
        queueMicrotask(() => {
          if (behavior.writeError) {
            stream.emit("error", behavior.writeError);
            return;
          }
          written.set(remotePath, data);
          stream.emit("close");
        });
      };
      return stream;
    },
    readdir: (
      _dir: string,
      callback: (error: Error | undefined, entries: Array<{ filename: string; attrs?: { size?: number; mtime?: number } }>) => void,
    ) => callback(undefined, []),
    unlink: (_path: string, callback: (error?: Error) => void) => callback(),
    rmdir: (_dir: string, callback: (error?: Error) => void) => callback(),
    end,
  } as unknown as ImageSftpClient & { end: ReturnType<typeof vi.fn> };
  return { sftp, written, end };
}

function connectedSession(instanceId: string, sftp: ImageSftpClient) {
  return {
    tabInstanceId: instanceId,
    isConnected: true,
    sshConn: {
      sftp: (callback: (err: Error | undefined, sftp: ImageSftpClient) => void) =>
        callback(undefined, sftp),
    },
  };
}

async function invoke(options: {
  file?: { buffer: Buffer; mimetype: string; size: number };
  instanceId?: string;
}) {
  const req = {
    userId: state.userId,
    body: options.instanceId ? { instanceId: options.instanceId } : {},
    file: options.file,
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

const LEGACY_ENV_NAMES = [
  "TERMIX_IMAGE_STORAGE_MODE",
  "TERMIX_IMAGE_DIR",
  "TERMIX_IMAGE_HOST_PATH",
  "TERMIX_IMAGE_TTL_MS",
  "TERMIX_MAX_IMAGE_COUNT",
  "TERMIX_MAX_IMAGE_STORAGE_BYTES",
  "DATA_DIR",
];

let pngBuffer: Buffer;
let savedEnv: Record<string, string | undefined>;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  state.settings = {};
  state.sessions = [];
  savedEnv = Object.fromEntries(
    LEGACY_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  for (const name of LEGACY_ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  for (const name of LEGACY_ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("terminal image upload route", () => {
  it("rejects requests without an image file", async () => {
    const response = await invoke({ instanceId: "tab-1" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "IMAGE_FILE_MISSING" });
  });

  it("requires a connected terminal in explicit remote-sftp mode", async () => {
    state.settings["terminal_image_storage_mode"] = "remote-sftp";
    const response = await invoke({
      file: { buffer: pngBuffer, mimetype: "image/png", size: pngBuffer.length },
      instanceId: "tab-1",
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: "IMAGE_TERMINAL_NOT_CONNECTED",
    });
  });

  it("writes over SFTP in auto mode when a session is connected", async () => {
    const { sftp, written, end } = fakeSftp();
    state.sessions = [connectedSession("tab-1", sftp)];

    const response = await invoke({
      file: { buffer: pngBuffer, mimetype: "image/png", size: pngBuffer.length },
      instanceId: "tab-1",
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      id: string;
      filename: string;
      shellPath: string;
      storage: string;
    };
    expect(body.storage).toBe("remote-sftp");
    expect(body.filename).toBe(`${body.id}.png`);
    expect(body.shellPath).toBe(`/tmp/termix-images/${body.filename}`);
    // Sharp normalized the upload to PNG before the write.
    const writtenBytes = written.get(body.shellPath)!;
    expect(writtenBytes.subarray(1, 4).toString()).toBe("PNG");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("maps SFTP failures to 502 without leaking the raw remote error", async () => {
    const { sftp, end } = fakeSftp({ writeError: new Error("Permission denied") });
    state.sessions = [connectedSession("tab-1", sftp)];

    const response = await invoke({
      file: { buffer: pngBuffer, mimetype: "image/png", size: pngBuffer.length },
      instanceId: "tab-1",
    });

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({
      error: "Failed to write image to the remote host",
      code: "IMAGE_REMOTE_WRITE_FAILED",
    });
    expect(JSON.stringify(response.body)).not.toContain("Permission denied");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("rejects undecodable image data", async () => {
    const { sftp } = fakeSftp();
    state.sessions = [connectedSession("tab-1", sftp)];

    const response = await invoke({
      file: {
        buffer: Buffer.from("definitely not an image"),
        mimetype: "image/png",
        size: 23,
      },
      instanceId: "tab-1",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });

  describe("local mapped storage", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "termix-route-test-"));
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("stores locally without a terminal session and hides backend paths", async () => {
      state.settings["terminal_image_storage_mode"] = "local";
      state.settings["terminal_image_local_dir"] = dir;
      state.settings["terminal_image_host_path"] = "/host-view/images";

      const response = await invoke({
        file: {
          buffer: pngBuffer,
          mimetype: "image/png",
          size: pngBuffer.length,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.body as {
        id: string;
        filename: string;
        shellPath: string;
        storage: string;
      };
      expect(body.storage).toBe("local");
      expect(body.shellPath).toBe(`/host-view/images/${body.filename}`);
      expect(JSON.stringify(body)).not.toContain(dir);
      const stored = await fs.readFile(path.join(dir, body.filename));
      expect(stored.subarray(1, 4).toString()).toBe("PNG");
    });

    it("answers 507 when the configured image count cap is reached", async () => {
      state.settings["terminal_image_storage_mode"] = "local";
      state.settings["terminal_image_local_dir"] = dir;
      state.settings["terminal_image_host_path"] = "/host-view/images";
      state.settings["terminal_image_max_count"] = "1";
      await fs.writeFile(
        path.join(dir, `${randomUUID()}.png`),
        Buffer.alloc(16),
      );

      const response = await invoke({
        file: {
          buffer: pngBuffer,
          mimetype: "image/png",
          size: pngBuffer.length,
        },
      });

      expect(response.statusCode).toBe(507);
      expect(response.body).toMatchObject({
        error: "Image storage limit reached",
        code: "IMAGE_STORAGE_LIMIT_REACHED",
      });
    });

    it("keeps legacy explicit local mappings on local mode", async () => {
      process.env.TERMIX_IMAGE_DIR = dir;
      process.env.TERMIX_IMAGE_HOST_PATH = "/host-view/images";

      const response = await invoke({
        file: {
          buffer: pngBuffer,
          mimetype: "image/png",
          size: pngBuffer.length,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ storage: "local" });
    });

    it("returns 503 when local storage inspection fails", async () => {
      const blocked = path.join(dir, "blocked-file");
      await fs.writeFile(blocked, "not a directory");
      state.settings["terminal_image_storage_mode"] = "local";
      state.settings["terminal_image_local_dir"] = blocked;
      state.settings["terminal_image_host_path"] = "/host-view/images";

      const response = await invoke({
        file: {
          buffer: pngBuffer,
          mimetype: "image/png",
          size: pngBuffer.length,
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.body).toEqual({
        error: "Unable to inspect local image storage",
        code: "IMAGE_LOCAL_INSPECTION_FAILED",
      });
      expect(JSON.stringify(response.body)).not.toContain(blocked);
    });
    it("rejects auto mode when no verified storage capability is available", async () => {
      process.env.DATA_DIR = dir;

      const response = await invoke({
        file: {
          buffer: pngBuffer,
          mimetype: "image/png",
          size: pngBuffer.length,
        },
        instanceId: "tab-missing",
      });

      expect(response.statusCode).toBe(503);
      expect(response.body).toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    });
  });
});
