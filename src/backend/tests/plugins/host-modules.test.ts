import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isBareSpecifier,
  isUserPluginFile,
} from "../../plugins/host-modules.js";

describe("isBareSpecifier", () => {
  it("accepts package names", () => {
    expect(isBareSpecifier("drizzle-orm")).toBe(true);
    expect(isBareSpecifier("drizzle-orm/sqlite-core")).toBe(true);
    expect(isBareSpecifier("@termix-ssh/plugin-sdk/backend")).toBe(true);
  });

  it("refuses paths, urls and builtins", () => {
    expect(isBareSpecifier("./local.js")).toBe(false);
    expect(isBareSpecifier("../up.js")).toBe(false);
    expect(isBareSpecifier("/abs/file.js")).toBe(false);
    expect(isBareSpecifier("file:///x.js")).toBe(false);
    expect(isBareSpecifier("node:fs")).toBe(false);
    expect(isBareSpecifier("C:\\x\\y.js")).toBe(false);
    expect(isBareSpecifier("#internal")).toBe(false);
  });
});

describe("isUserPluginFile", () => {
  const root = path.resolve(os.tmpdir(), "termix-data", "plugins");

  it("matches files under the plugins dir, query included", () => {
    const file = path.join(root, ".unpacked", "demo", "dist", "backend.js");
    expect(isUserPluginFile(`${pathToFileURL(file).href}?v=1`, root)).toBe(
      true,
    );
  });

  it("ignores everything else", () => {
    const outside = path.resolve(os.tmpdir(), "termix-data", "other.js");
    expect(isUserPluginFile(pathToFileURL(outside).href, root)).toBe(false);
    expect(isUserPluginFile(pathToFileURL(root).href, root)).toBe(false);
    expect(isUserPluginFile(undefined, root)).toBe(false);
    expect(isUserPluginFile("data:text/javascript,1", root)).toBe(false);
  });
});

describe("installHostModuleFallback", () => {
  let dataDir: string | null = null;

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  // A real Node process: vitest resolves imports on its own and would hide
  // what plain Node does.
  function importFromPlugin(withFallback: boolean) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-host-modules-"));
    const dir = path.join(dataDir, "plugins", ".unpacked", "demo");
    fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, "backend.mjs");
    fs.writeFileSync(
      entry,
      'import { sql } from "drizzle-orm";\nconsole.log(typeof sql);\n',
    );
    const hook = pathToFileURL(
      path.resolve(__dirname, "../../plugins/host-modules.ts"),
    ).href;
    const script = [
      `const { installHostModuleFallback } = await import(${JSON.stringify(hook)});`,
      withFallback ? "installHostModuleFallback();" : "",
      `await import(${JSON.stringify(`${pathToFileURL(entry).href}?v=1`)});`,
    ].join("\n");
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: path.resolve(__dirname, "../../../.."),
        env: { ...process.env, DATA_DIR: dataDir },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
  }

  it("lets a plugin outside the app import core's packages", () => {
    const result = importFromPlugin(true);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("function");
  });

  it("fails the same import without it", () => {
    const result = importFromPlugin(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot find package 'drizzle-orm'");
  });
});
