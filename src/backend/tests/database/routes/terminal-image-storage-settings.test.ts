import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_HOST_PATH,
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_IMAGE_MAX_COUNT,
  DEFAULT_IMAGE_TTL_MS,
  defaultImageLocalDir,
  parseImageHostPath,
  parseImageLocalDir,
  parseTerminalImageStorageMode,
  resolveTerminalImageStorageSettings,
  TERMINAL_IMAGE_STORAGE_KEYS,
} from "../../../database/routes/terminal-image-storage-settings.js";
import { SettingsRepository } from "../../../database/repositories/settings-repository.js";
import { TestSqliteDatabase } from "../repositories/test-support.js";

function stubSettings(values: Record<string, string> = {}) {
  return {
    get: async (key: string) => values[key] ?? null,
  };
}

const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe("terminal image storage settings", () => {
  describe("mode parsing", () => {
    it("accepts the three documented modes case-insensitively", () => {
      expect(parseTerminalImageStorageMode("auto")).toBe("auto");
      expect(parseTerminalImageStorageMode("LOCAL")).toBe("local");
      expect(parseTerminalImageStorageMode(" remote-sftp ")).toBe(
        "remote-sftp",
      );
    });

    it("rejects unknown modes and non-strings", () => {
      expect(parseTerminalImageStorageMode("s3")).toBeNull();
      expect(parseTerminalImageStorageMode("")).toBeNull();
      expect(parseTerminalImageStorageMode(undefined)).toBeNull();
    });
  });

  describe("path validation", () => {
    it("accepts absolute local directories and normalizes them", () => {
      expect(parseImageLocalDir("/var/lib/termix/images")).toBe(
        "/var/lib/termix/images",
      );
      expect(parseImageLocalDir("/var/lib/termix/../termix/images")).toBeNull();
    });

    it("rejects relative, empty and NUL-containing local directories", () => {
      expect(parseImageLocalDir("images")).toBeNull();
      expect(parseImageLocalDir("./db/data/images")).toBeNull();
      expect(parseImageLocalDir("")).toBeNull();
      expect(parseImageLocalDir("/tmp/a\0b")).toBeNull();
    });

    it("requires the agent-visible host path to be POSIX-absolute", () => {
      expect(parseImageHostPath("/tmp/termix-image-v0")).toBe(
        "/tmp/termix-image-v0",
      );
      expect(parseImageHostPath("tmp/termix-image-v0")).toBeNull();
      expect(parseImageHostPath("C:\\images")).toBeNull();
      expect(parseImageHostPath("/tmp/a\0b")).toBeNull();
    });
  });

  describe("resolution precedence", () => {
    it("uses built-in defaults when neither the database nor env has values", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings(),
        EMPTY_ENV,
      );
      expect(resolved.mode).toBe("auto");
      expect(resolved.localDir).toBe(defaultImageLocalDir(EMPTY_ENV));
      expect(resolved.hostPath).toBe(DEFAULT_IMAGE_HOST_PATH);
      expect(resolved.ttlMs).toBe(DEFAULT_IMAGE_TTL_MS);
      expect(resolved.maxCount).toBe(DEFAULT_IMAGE_MAX_COUNT);
      expect(resolved.maxBytes).toBe(DEFAULT_IMAGE_MAX_BYTES);
    });

    it("seeds defaults from legacy TERMIX_IMAGE_* env when no DB value exists", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings(),
        {
          TERMIX_IMAGE_DIR: "/host-tmp/images",
          TERMIX_IMAGE_HOST_PATH: "/tmp/images",
          TERMIX_IMAGE_TTL_MS: "60000",
          TERMIX_MAX_IMAGE_COUNT: "5",
          TERMIX_MAX_IMAGE_STORAGE_BYTES: "10485760",
        },
      );
      expect(resolved.localDir).toBe("/host-tmp/images");
      expect(resolved.hostPath).toBe("/tmp/images");
      expect(resolved.ttlMs).toBe(60_000);
      expect(resolved.maxCount).toBe(5);
      expect(resolved.maxBytes).toBe(10_485_760);
    });

    it("lets persisted DB values win over legacy env values", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings({
          [TERMINAL_IMAGE_STORAGE_KEYS.localDir]: "/db/images",
          [TERMINAL_IMAGE_STORAGE_KEYS.ttlMs]: "1000",
          [TERMINAL_IMAGE_STORAGE_KEYS.maxCount]: "7",
        }),
        {
          TERMIX_IMAGE_DIR: "/host-tmp/images",
          TERMIX_IMAGE_TTL_MS: "60000",
          TERMIX_MAX_IMAGE_COUNT: "5",
        },
      );
      expect(resolved.localDir).toBe("/db/images");
      expect(resolved.ttlMs).toBe(1_000);
      expect(resolved.maxCount).toBe(7);
    });

    it("falls through to env and defaults when the DB value is invalid", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings({
          [TERMINAL_IMAGE_STORAGE_KEYS.localDir]: "relative/path",
          [TERMINAL_IMAGE_STORAGE_KEYS.ttlMs]: "not-a-number",
        }),
        { TERMIX_IMAGE_DIR: "/host-tmp/images" },
      );
      expect(resolved.localDir).toBe("/host-tmp/images");
      expect(resolved.ttlMs).toBe(DEFAULT_IMAGE_TTL_MS);
    });

    it("keeps legacy explicit local mappings on local mode", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings(),
        { TERMIX_IMAGE_DIR: "/host-tmp/images" },
      );
      expect(resolved.mode).toBe("local");
      expect(resolved.hostPath).toBe("/host-tmp/images");
      expect(resolved.localMappingConfigured).toBe(true);
    });

    it("lets a persisted DB mode override the legacy local mapping", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings({
          [TERMINAL_IMAGE_STORAGE_KEYS.mode]: "remote-sftp",
        }),
        { TERMIX_IMAGE_DIR: "/host-tmp/images" },
      );
      expect(resolved.mode).toBe("remote-sftp");
    });

    it("clamps out-of-range numeric values like the legacy env parsing did", async () => {
      const resolved = await resolveTerminalImageStorageSettings(
        stubSettings(),
        {
          TERMIX_IMAGE_TTL_MS: "-5",
          TERMIX_MAX_IMAGE_COUNT: "0",
          TERMIX_MAX_IMAGE_STORAGE_BYTES: "10",
        },
      );
      expect(resolved.ttlMs).toBe(0);
      expect(resolved.maxCount).toBe(1);
      expect(resolved.maxBytes).toBe(1_048_576);
    });

    it("reads persisted values through the real settings repository", async () => {
      const adapter = new TestSqliteDatabase();
      try {
        const context = await adapter.connect();
        const repository = new SettingsRepository(context);
        await repository.set(TERMINAL_IMAGE_STORAGE_KEYS.mode, "local");
        await repository.set(
          TERMINAL_IMAGE_STORAGE_KEYS.localDir,
          "/persisted/images",
        );

        const resolved = await resolveTerminalImageStorageSettings(
          repository,
          { TERMIX_IMAGE_DIR: "/host-tmp/images" },
        );
        expect(resolved.mode).toBe("local");
        expect(resolved.localDir).toBe("/persisted/images");
      } finally {
        await adapter.close();
      }
    });
  });
});
