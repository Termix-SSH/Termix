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
  const plugin = path.join(root, "fixture");
  fs.mkdirSync(plugin);
  fs.writeFileSync(
    path.join(plugin, "manifest.json"),
    JSON.stringify({ id: "fixture" }),
  );
  fs.writeFileSync(
    path.join(plugin, "package.json"),
    JSON.stringify({ name: "fixture" }),
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
