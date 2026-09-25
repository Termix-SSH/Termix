import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { pack } from "../packages/plugin-sdk/cli/commands/pack.mjs";

const cleanups: Array<() => void> = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(root: string, rel: string, content: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function fixturePlugin(manifest: Record<string, unknown> = {}): string {
  const dir = path.join(tempDir("termix-pack-"), "pack-fixture");
  writeFile(
    dir,
    "manifest.json",
    JSON.stringify({
      id: "pack-fixture",
      name: "Pack Fixture",
      version: "1.2.3",
      description: "Fixture for the pack tests.",
      author: { name: "Termix Tests" },
      license: "MIT",
      category: "Productivity",
      engine: { termix: ">=2.9.0", api: "1" },
      capabilities: [],
      ...manifest,
    }),
  );
  writeFile(dir, "dist/backend.js", "export async function activate() {}\n");
  writeFile(dir, "dist/frontend.js", "export function activate() {}\n");
  writeFile(dir, "locales/en.json", "{}\n");
  writeFile(dir, "migrations/sqlite/0001_init.sql", "SELECT 1;\n");
  writeFile(dir, "migrations/postgres/0001_init.sql", "SELECT 1;\n");
  writeFile(dir, "migrations/mysql/0001_init.sql", "SELECT 1;\n");
  writeFile(dir, "README.md", "# Fixture\n");
  writeFile(dir, "icon.svg", "<svg/>\n");
  writeFile(dir, "src/backend/index.ts", "left out of the archive\n");
  return dir;
}

function sha(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

async function entries(file: string): Promise<string[]> {
  const names: string[] = [];
  await tar.t({ file, onReadEntry: (entry) => names.push(entry.path) });
  return names;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()?.();
});

describe("termix-plugin pack", () => {
  it("gives the same sha256 when rebuilt with new mtimes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fixturePlugin();
    const first = await pack({ cwd: dir, args: ["--out", tempDir("a-")] });

    const later = new Date(Date.now() + 86_400_000);
    for (const rel of ["manifest.json", "dist/backend.js", "README.md"]) {
      fs.utimesSync(path.join(dir, rel), later, later);
    }
    const second = await pack({ cwd: dir, args: ["--out", tempDir("b-")] });

    expect(path.basename(first)).toBe("pack-fixture-1.2.3.tmxplug");
    expect(sha(first)).toBe(sha(second));
  });

  it("holds only the shipped files, sorted, with fixed metadata", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fixturePlugin();
    const file = await pack({ cwd: dir, args: ["--out", tempDir("c-")] });

    const names = await entries(file);
    expect(names).toEqual([
      "README.md",
      "dist/backend.js",
      "dist/frontend.js",
      "icon.svg",
      "locales/en.json",
      "manifest.json",
      "migrations/mysql/0001_init.sql",
      "migrations/postgres/0001_init.sql",
      "migrations/sqlite/0001_init.sql",
    ]);

    const meta: Array<{ mode: number; mtime: number; uid: number }> = [];
    await tar.t({
      file,
      onReadEntry: (entry) =>
        meta.push({
          mode: entry.mode ?? -1,
          mtime: entry.mtime?.getTime() ?? -1,
          uid: entry.uid ?? -1,
        }),
    });
    expect(new Set(meta.map((m) => JSON.stringify(m)))).toEqual(
      new Set([JSON.stringify({ mode: 0o644, mtime: 0, uid: 0 })]),
    );

    const gz = fs.readFileSync(file);
    expect(gz.readUInt32LE(4)).toBe(0);
    expect(gz[9]).toBe(0x03);

    const out = tempDir("x-");
    await tar.x({ file, cwd: out });
    expect(fs.readFileSync(path.join(out, "dist/backend.js"), "utf8")).toBe(
      "export async function activate() {}\n",
    );
  });

  it("refuses a manifest with errors", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = fixturePlugin({ capabilities: ["not:a-capability"] });
    const out = tempDir("d-");
    await expect(pack({ cwd: dir, args: ["--out", out] })).rejects.toThrow(
      /manifest is not valid/,
    );
    expect(fs.readdirSync(out)).toEqual([]);
  });
});
