import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import {
  readArtifactFile,
  readArtifactManifest,
  sameCapabilities,
} from "../../plugins/artifact-manifest.js";

function pack(files: Record<string, string>, prefix = ""): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-artifact-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    const file = path.join(dir, "out.tmxplug");
    tar.c(
      { gzip: true, sync: true, file, cwd: dir },
      Object.keys(files).map((name) => `${prefix}${name}`),
    );
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("readArtifactFile", () => {
  it("finds a file by name, with or without a ./ prefix", () => {
    const plain = pack({ "manifest.json": "{}", "dist/a.js": "x" });
    expect(readArtifactFile(plain, "dist/a.js")?.toString()).toBe("x");
    const dotted = pack({ "manifest.json": '{"id":"a"}' }, "./");
    expect(readArtifactFile(dotted, "manifest.json")?.toString()).toBe(
      '{"id":"a"}',
    );
  });

  it("returns null for a missing file", () => {
    expect(readArtifactFile(pack({ "a.txt": "a" }), "manifest.json")).toBe(
      null,
    );
  });
});

describe("readArtifactManifest", () => {
  it("parses the manifest", () => {
    expect(
      readArtifactManifest(pack({ "manifest.json": '{"id":"notes"}' })),
    ).toEqual({ id: "notes" });
  });

  it("refuses a file that is not an archive", () => {
    expect(() => readArtifactManifest(Buffer.from("nope"))).toThrow(
      /not a valid .tmxplug/,
    );
  });

  it("refuses an archive with no manifest or a broken one", () => {
    expect(() => readArtifactManifest(pack({ "a.txt": "a" }))).toThrow(
      /no manifest.json/,
    );
    expect(() =>
      readArtifactManifest(pack({ "manifest.json": "{oops" })),
    ).toThrow(/not valid JSON/);
    expect(() =>
      readArtifactManifest(pack({ "manifest.json": "[1]" })),
    ).toThrow(/not an object/);
  });
});

describe("sameCapabilities", () => {
  it("compares as sets", () => {
    expect(sameCapabilities(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameCapabilities(["a"], ["a", "b"])).toBe(false);
    expect(sameCapabilities(["a", "c"], ["a", "b"])).toBe(false);
    expect(sameCapabilities([], [])).toBe(true);
  });
});
