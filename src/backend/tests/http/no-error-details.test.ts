import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const BACKEND = path.resolve(__dirname, "../..");

// The proxy test reports why the user's own proxy refused, which is the point
// of that check.
const ALLOWED = new Set(["database/routes/host-network-routes.ts:proxy_test"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") sources(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const SERVER_ERROR = /status\(\s*5\d\d\s*\)\s*\.json\(\s*\{[\s\S]*?\}\s*\)/g;
const LEAKS = /getErrorMessage\(|\.message\b|\.stack\b|String\((err|error|e)\)/;

describe("server error responses", () => {
  it("never echo error text, stacks or paths", () => {
    const found: string[] = [];
    for (const file of sources(BACKEND)) {
      const text = fs.readFileSync(file, "utf8");
      const relative = path.relative(BACKEND, file).replaceAll(path.sep, "/");
      for (const match of text.matchAll(SERVER_ERROR)) {
        if (!LEAKS.test(match[0])) continue;
        const before = text.slice(Math.max(0, match.index - 400), match.index);
        const operation = /operation: "([^"]+)"[^]*$/.exec(before)?.[1];
        if (ALLOWED.has(`${relative}:${operation}`)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        found.push(`${relative}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });
});
