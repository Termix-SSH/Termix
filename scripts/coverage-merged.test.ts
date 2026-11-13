import { describe, expect, it } from "vitest";
import { lineHits, merge, repoPath } from "./coverage-merged.mjs";

const file = (lines: Record<number, number>) => ({
  statementMap: Object.fromEntries(
    Object.keys(lines).map((line, i) => [
      String(i),
      { start: { line: Number(line) }, end: { line: Number(line) } },
    ]),
  ),
  s: Object.fromEntries(
    Object.values(lines).map((hits, i) => [String(i), hits]),
  ),
});

describe("coverage-merged", () => {
  it("makes Windows and Linux paths the same", () => {
    expect(repoPath("C:\\Users\\x\\Termix\\src\\backend\\a.ts")).toBe(
      "src/backend/a.ts",
    );
    expect(repoPath("/home/x/termix-cov/packages/plugin-sdk/src/b.ts")).toBe(
      "packages/plugin-sdk/src/b.ts",
    );
  });

  it("counts a line covered when either run ran it, and skips test code", () => {
    const unit = lineHits({
      "/r/src/a.ts": file({ 1: 1, 2: 0, 3: 0 }),
      "/r/src/tests/helper.ts": file({ 1: 0 }),
      "/r/src/b.test.ts": file({ 1: 0 }),
    });
    const authz = lineHits({
      "C:\\r\\src\\a.ts": file({ 2: 3 }),
      "C:\\r\\src\\only-matrix.ts": file({ 1: 1 }),
    });
    expect(merge(unit, authz)).toEqual({
      total: 3,
      unitCovered: 1,
      covered: 2,
    });
  });
});
