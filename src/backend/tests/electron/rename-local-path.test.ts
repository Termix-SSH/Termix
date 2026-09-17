import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
const { renameLocalPath } = createRequire(import.meta.url)(
  "../../../../electron/rename-local-path.cjs",
);
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-rename-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
describe("local rename", () => {
  it("preserves both files on a name collision", () => {
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    fs.writeFileSync(a, "source");
    fs.writeFileSync(b, "destination");
    expect(() => renameLocalPath(a, b)).toThrow(/already exists/);
    expect(fs.readFileSync(a, "utf8")).toBe("source");
    expect(fs.readFileSync(b, "utf8")).toBe("destination");
  });
  it("refuses to replace even an empty destination directory", () => {
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    expect(() => renameLocalPath(a, b)).toThrow(/already exists/);
    expect(fs.readdirSync(root).sort()).toEqual(["a", "b"]);
  });
  it("renames a file and handles an unchanged name", () => {
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    fs.writeFileSync(a, "source");
    renameLocalPath(a, a);
    renameLocalPath(a, b);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.readFileSync(b, "utf8")).toBe("source");
  });
});
