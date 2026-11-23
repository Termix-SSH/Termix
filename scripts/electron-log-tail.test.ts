import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readLogTail } = require("../electron/log-tail.cjs") as {
  readLogTail: (
    fsModule: typeof fs,
    file: string,
    options?: { maxBytes?: number; maxLines?: number },
  ) => string[];
};

let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function logWith(text: string): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-tail-"));
  const file = path.join(dir, "termix-main.log");
  fs.writeFileSync(file, text);
  return file;
}

describe("readLogTail", () => {
  it("returns the last lines", () => {
    const file = logWith("a\nb\nc\n");
    expect(readLogTail(fs, file, { maxLines: 2 })).toEqual(["b", "c"]);
  });

  it("drops the cut line when it reads from the middle", () => {
    const file = logWith("first line\nsecond\nthird\n");
    expect(readLogTail(fs, file, { maxBytes: 10 })).toEqual(["third"]);
  });

  it("gives nothing for a missing file", () => {
    expect(readLogTail(fs, path.join(os.tmpdir(), "nope-12345.log"))).toEqual(
      [],
    );
  });
});
