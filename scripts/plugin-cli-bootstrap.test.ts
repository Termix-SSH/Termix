import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-cli-bootstrap-"));
  roots.push(root);
  const repo = path.resolve(import.meta.dirname, "..");
  fs.cpSync(
    path.join(repo, "packages/plugin-sdk/cli"),
    path.join(root, "packages/plugin-sdk/cli"),
    { recursive: true },
  );
  fs.symlinkSync(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(
    path.join(repo, "scripts/apply-plugin-patches.cjs"),
    path.join(root, "scripts/apply-plugin-patches.cjs"),
  );
  const plugin = path.join(root, "plugins/fixture");
  fs.mkdirSync(path.join(plugin, "patches"), { recursive: true });
  fs.writeFileSync(
    path.join(plugin, "manifest.json"),
    JSON.stringify({ id: "fixture" }),
  );
  fs.writeFileSync(
    path.join(plugin, "package.json"),
    JSON.stringify({ name: "fixture" }),
  );
  fs.writeFileSync(
    path.join(plugin, "patches/check.cjs"),
    'require("node:fs").writeFileSync("patched", "ok");',
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, args, { cwd: plugin, encoding: "utf8" });
  return {
    root,
    plugin,
    run,
    cli: path.join(root, "packages/plugin-sdk/cli/index.mjs"),
  };
}

describe("plugin CLI before the SDK is built", () => {
  it("runs the postinstall plugin patches without SDK dist files", () => {
    const { root, plugin, run } = fixture();
    expect(fs.existsSync(path.join(root, "packages/plugin-sdk/dist"))).toBe(
      false,
    );
    const result = run(path.join(root, "scripts/apply-plugin-patches.cjs"));
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(plugin, "patched"), "utf8")).toBe("ok");
  });
  it("prints help without SDK dist files", () => {
    const { cli, run } = fixture();
    const result = run(cli, "--help");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage: termix-plugin");
  });
  it("still requires a built SDK for validation with an actionable error", () => {
    const { cli, run } = fixture();
    const result = run(cli, "validate");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Run: npm run build:sdk");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
