import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const notarizeScriptPath = path.resolve(
  __dirname,
  "../packaging/build/notarize.cjs",
);

describe("packaging/build/notarize.cjs", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    delete require.cache[notarizeScriptPath];
  });

  it("rethrows notarization failures after logging the error", async () => {
    const failure = new Error("notarytool authentication failed");
    const notarizePkgPath = require.resolve("@electron/notarize");
    const originalModule = require.cache[notarizePkgPath];

    require.cache[notarizePkgPath] = {
      id: notarizePkgPath,
      filename: notarizePkgPath,
      loaded: true,
      exports: {
        notarize: vi.fn().mockRejectedValue(failure),
      },
    } as unknown as NodeModule;

    delete require.cache[notarizeScriptPath];
    const { default: notarizing } = require(notarizeScriptPath) as {
      default: (context: unknown) => Promise<void>;
    };

    process.env.APPLE_ID = "dev@example.com";
    process.env.APPLE_ID_PASSWORD = "app-specific-password";
    process.env.APPLE_TEAM_ID = "TEAM123456";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        notarizing({
          electronPlatformName: "darwin",
          appOutDir: "/tmp/out",
          packager: { appInfo: { productFilename: "Termix" } },
        }),
      ).rejects.toThrow("notarytool authentication failed");

      expect(errorSpy).toHaveBeenCalledWith("Notarization failed:", failure);
    } finally {
      if (originalModule) {
        require.cache[notarizePkgPath] = originalModule;
      } else {
        delete require.cache[notarizePkgPath];
      }
    }
  });

  it("excludes eslint.config.mjs in electron-builder.json", () => {
    const builderConfig = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../electron-builder.json"),
        "utf8",
      ),
    ) as { files: string[] };

    expect(builderConfig.files).toContain("!eslint.config.mjs");
    expect(builderConfig.files).not.toContain("!eslint.config.js");
  });
});
