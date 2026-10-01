import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { ALLOWED, compare, exportedNames } =
  require("./check-sdk-ui-exports.cjs") as {
    ALLOWED: string[];
    compare: (
      names: string[],
      allowed?: string[],
    ) => { added: string[]; removed: string[] };
    exportedNames: (file?: string, tsconfig?: string) => string[];
  };

let dir: string | null = null;

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("compare", () => {
  it("names what was added and what was dropped", () => {
    expect(compare(["a", "b", "c"], ["a", "b", "d"])).toEqual({
      added: ["c"],
      removed: ["d"],
    });
    expect(compare(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });

  it("keeps the allowlist free of duplicates", () => {
    expect(new Set(ALLOWED).size).toBe(ALLOWED.length);
  });
});

describe("exportedNames", () => {
  it("follows export * and renamed exports", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ui-exports-"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "esnext", strict: true } }),
    );
    fs.writeFileSync(
      path.join(dir, "parts.ts"),
      "export const Button = 1;\nexport type ButtonProps = { a: 1 };\n",
    );
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      'export * from "./parts";\nconst theme = 2;\nexport { theme as useAppTheme };\n',
    );
    expect(
      exportedNames(
        path.join(dir, "entry.ts"),
        path.join(dir, "tsconfig.json"),
      ),
    ).toEqual(["Button", "ButtonProps", "useAppTheme"]);
  });
});
