import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { copyPluginSdk } =
  require("../../../../packaging/build/after-pack.cjs") as {
    copyPluginSdk: (resourcesDir: string, sdkDir?: string) => string;
  };

let dir: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("afterPack plugin SDK copy", () => {
  it("ships the SDK package.json and dist where the packaged backend resolves it", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-after-pack-"));
    const sdk = path.join(dir, "sdk");
    fs.mkdirSync(path.join(sdk, "dist"), { recursive: true });
    fs.mkdirSync(path.join(sdk, "src"));
    fs.writeFileSync(
      path.join(sdk, "package.json"),
      '{"name":"@termix/plugin-sdk"}',
    );
    fs.writeFileSync(path.join(sdk, "dist", "settings.js"), "export {};");
    fs.writeFileSync(path.join(sdk, "src", "settings.ts"), "");
    const resources = path.join(dir, "resources");

    const target = copyPluginSdk(resources, sdk);

    expect(target).toBe(
      path.join(
        resources,
        "app.asar.unpacked",
        "node_modules",
        "@termix",
        "plugin-sdk",
      ),
    );
    expect(fs.readdirSync(target).sort()).toEqual(["dist", "package.json"]);
    expect(fs.existsSync(path.join(target, "dist", "settings.js"))).toBe(true);
  });

  it("stops the build when the SDK was never built", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-after-pack-"));
    const sdk = path.join(dir, "sdk");
    fs.mkdirSync(sdk);
    fs.writeFileSync(path.join(sdk, "package.json"), "{}");
    expect(() => copyPluginSdk(path.join(dir, "resources"), sdk)).toThrow(
      "npm run build:sdk",
    );
  });
});
