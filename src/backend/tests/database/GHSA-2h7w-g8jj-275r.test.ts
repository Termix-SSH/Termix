import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExportFile,
  exportDownloadName,
} from "../../database/export-file.js";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("GHSA-2h7w-g8jj-275r database export file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-export-test-"));
  made.push(root);

  it.each([
    "../../etc/profile.d/pwn",
    "..\\..\\Windows\\pwn",
    "/abs/path",
    "a/../../b",
    "\u0000nul",
    'quote"; filename=evil',
  ])("keeps the file inside the export folder for %j", (username) => {
    const file = createExportFile(root);
    made.push(file.dir);
    const resolved = path.resolve(file.path);
    expect(resolved.startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(path.dirname(resolved)).toBe(path.resolve(file.dir));
    expect(path.basename(resolved)).toMatch(
      /^termix-export-[0-9a-f-]+\.sqlite$/,
    );

    const name = exportDownloadName(username, new Date(0));
    expect(name).toMatch(/^termix-export-[A-Za-z0-9._-]+-[0-9TZ-]+\.sqlite$/);
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain('"');
    expect(name).not.toContain("..");
  });

  it("gives every export its own file", () => {
    const a = createExportFile(root);
    const b = createExportFile(root);
    made.push(a.dir, b.dir);
    expect(a.path).not.toBe(b.path);
  });

  it("never builds the export path from the username", () => {
    const source = fs.readFileSync(
      new URL("../../database/database.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/termix-export-\$\{user\.username\}/);
    expect(source).toContain("createExportFile(");
    expect(source).not.toMatch(/filename="\$\{filename\}"/);
  });

  it("does not name uploads after the client's file name", () => {
    const source = fs.readFileSync(
      new URL("../../database/database.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\$\{timestamp\}-\$\{file\.originalname\}/);
  });
});
