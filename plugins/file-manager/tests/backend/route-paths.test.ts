import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pluginDir } from "./helpers";

function read(relative: string): string {
  return fs.readFileSync(path.join(pluginDir, relative), "utf8");
}

/** Every "/path" the frontend's SSH client sends, without its parameters. */
function frontendPaths(): string[] {
  const source = read("src/frontend/api/ssh-file-operations-api.ts");
  const paths = new Set<string>();
  for (const match of source.matchAll(/["`](\/[A-Za-z][\w-]*(?:\/[\w-]+)*)/g)) {
    paths.add(match[1]);
  }
  return [...paths];
}

/** Every route the backend's express app registers. */
function backendPaths(): Set<string> {
  const paths = new Set<string>();
  const dir = path.join(pluginDir, "src/backend");
  for (const file of fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `src/backend/${name}`)) {
    for (const match of read(file).matchAll(
      /app\.(?:get|post|put|delete|patch)\(\s*"(\/[^"]*)"/g,
    )) {
      paths.add(match[1].replace(/\/:[\w]+$/, ""));
    }
  }
  return paths;
}

describe("file manager routes", () => {
  it("serves every path the frontend's SSH client calls", () => {
    const served = backendPaths();
    const missing = frontendPaths().filter((p) => !served.has(p));
    expect(missing).toEqual([]);
  });
});
