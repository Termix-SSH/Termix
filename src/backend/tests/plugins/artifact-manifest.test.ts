import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as tar from "tar";
import {
  readArtifactFiles,
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

/** Two archives' entries back to back, so a name can appear twice. */
function concat(first: Buffer, second: Buffer): Buffer {
  const entries = (buffer: Buffer) => {
    const raw = zlib.gunzipSync(buffer);
    // Drop the two zero blocks that end every tar.
    return raw.subarray(0, raw.length - 1024);
  };
  return zlib.gzipSync(
    Buffer.concat([entries(first), entries(second), Buffer.alloc(1024)]),
  );
}

describe("readArtifactFiles", () => {
  it("finds a file by name, with or without a ./ prefix", () => {
    const plain = pack({ "manifest.json": "{}", "dist/a.js": "x" });
    expect(
      readArtifactFiles(plain, "dist/a.js").map((b) => b.toString()),
    ).toEqual(["x"]);
    const dotted = pack({ "manifest.json": '{"id":"a"}' }, "./");
    expect(
      readArtifactFiles(dotted, "manifest.json").map((b) => b.toString()),
    ).toEqual(['{"id":"a"}']);
  });

  it("returns nothing for a missing file", () => {
    expect(readArtifactFiles(pack({ "a.txt": "a" }), "manifest.json")).toEqual(
      [],
    );
  });

  it("resolves names that need a pax header", () => {
    const long = `dist/${"x".repeat(150)}.js`;
    const archive = pack({ "manifest.json": "{}", [long]: "x" });
    expect(readArtifactFiles(archive, long).map((b) => b.toString())).toEqual([
      "x",
    ]);
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

  it("refuses an archive with two manifests", () => {
    const first = pack({ "manifest.json": '{"capabilities":[]}' });
    const second = pack({ "manifest.json": '{"capabilities":["ssh"]}' });
    expect(() => readArtifactManifest(concat(first, second))).toThrow(
      /more than one manifest.json/,
    );
    const upper = pack({ "MANIFEST.JSON": '{"capabilities":["ssh"]}' });
    expect(() => readArtifactManifest(concat(first, upper))).toThrow(
      /more than one manifest.json/,
    );
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
