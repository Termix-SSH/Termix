import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../packages/plugin-sdk/cli/commands/build.mjs";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
});

function fixturePlugin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-build-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ id: "build-fixture" }),
  );
  fs.mkdirSync(path.join(dir, "src", "backend"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "backend", "index.ts"),
    "export function activate() {}\n",
  );
  return dir;
}

describe("termix-plugin build", () => {
  it("marks dist as ESM so Node loads backend.js without reparsing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fixturePlugin();

    await build({ cwd: dir });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "dist", "package.json"), "utf8"),
    );
    expect(pkg).toEqual({ type: "module" });
    expect(fs.existsSync(path.join(dir, "dist", "backend.js"))).toBe(true);
  });
});
