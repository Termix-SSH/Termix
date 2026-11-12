import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : sources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("backend listeners", () => {
  it("bind only to loopback", () => {
    const calls = sources("src/backend").flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /\.listen\(/.test(line))
        .map((line) => ({ file, line: line.trim() })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.line, call.file).toMatch(/\.listen\([^,]+,\s*"127\.0\.0\.1"/);
    }
  });
});
