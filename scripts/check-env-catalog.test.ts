import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { readNames } = require("./check-env-catalog.cjs") as {
  readNames: (root: string) => Map<string, string>;
};

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function fixture(files: Record<string, string>): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "env-catalog-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("readNames", () => {
  it("finds every way core reads an env var", () => {
    const dir = fixture({
      "src/backend/a.ts": [
        "const a = process.env.FIRST_VAR;",
        'const b = process.env["SECOND_VAR"];',
        "const c = env.THIRD_VAR;",
        'export const X_ENV =\n  "FOURTH_VAR";',
      ].join("\n"),
      "electron/main.cjs": "process.env.DESKTOP_VAR",
    });
    expect([...readNames(dir).keys()].sort()).toEqual([
      "DESKTOP_VAR",
      "FIRST_VAR",
      "FOURTH_VAR",
      "SECOND_VAR",
      "THIRD_VAR",
    ]);
  });

  it("skips tests", () => {
    const dir = fixture({
      "src/backend/tests/a.test.ts": "process.env.ONLY_IN_TESTS",
      "src/backend/b.test.ts": "process.env.ALSO_TESTS",
    });
    expect(readNames(dir).size).toBe(0);
  });
});
