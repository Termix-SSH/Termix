/**
 * The desktop checks its pinned Node and sandbox helper before the first
 * plugin starts, and refuses plugin backends on builds without them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkRuntime } = require("../../../../electron/plugin-runtime.cjs");
const {
  runtimeHash,
  peRanges,
} = require("../../../../electron/runtime-hash.cjs");

let base: string;
let resources: string;
let lockPath: string;

/** A small PE32+ file with an optional signature table at the end. */
function fakePe(signature: Buffer | null, checksum = 0): Buffer {
  const body = Buffer.alloc(0x400, 0x11);
  body.writeUInt16LE(0x5a4d, 0);
  body.writeUInt32LE(0x80, 0x3c);
  body.writeUInt32LE(0x4550, 0x80);
  const optional = 0x80 + 24;
  body.writeUInt16LE(0x20b, optional);
  body.writeUInt32LE(checksum, optional + 64);
  const certEntry = optional + 112 + 32;
  if (!signature) {
    body.writeUInt32LE(0, certEntry);
    body.writeUInt32LE(0, certEntry + 4);
    return body;
  }
  // Signing pads to 8 bytes before the table.
  const padded = Buffer.concat([
    body,
    Buffer.alloc(8 - (body.length % 8 || 8)),
  ]);
  padded.writeUInt32LE(padded.length, certEntry);
  padded.writeUInt32LE(signature.length, certEntry + 4);
  return Buffer.concat([padded, signature]);
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "termix-runtime-"));
  resources = path.join(base, "resources");
  const dir = path.join(resources, "plugin-runtime");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node"), "node binary");
  fs.writeFileSync(path.join(dir, "termix-plugin-jail"), "helper binary");
  lockPath = path.join(base, "lock.json");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      version: "26.13.1",
      files: {
        "linux-x64": {
          node: runtimeHash(path.join(dir, "node")),
          "termix-plugin-jail": runtimeHash(
            path.join(dir, "termix-plugin-jail"),
          ),
        },
      },
    }),
  );
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const options = () => ({
  isPackaged: true,
  resourcesPath: resources,
  platform: "linux",
  arch: "x64",
  lockPath,
});

describe("plugin runtime check", () => {
  it("accepts the files the lock names", () => {
    const result = checkRuntime(options());
    expect(result.error).toBeUndefined();
    expect(result.node).toBe(path.join(resources, "plugin-runtime", "node"));
    expect(result.version).toBe("26.13.1");
  });

  it("refuses a changed binary", () => {
    const result = checkRuntime(options(), {
      hash: (file: string) =>
        file.endsWith("node") ? "changed" : runtimeHash(file),
    });
    expect(result.error).toMatch(/node does not match/);
  });

  it("refuses when the lock has no entry for this build", () => {
    expect(checkRuntime({ ...options(), arch: "arm64" }).error).toBeTruthy();
    expect(
      checkRuntime({ ...options(), lockPath: path.join(base, "none.json") })
        .error,
    ).toMatch(/lock/);
  });

  it("says plainly when a build has no runtime at all", () => {
    const result = checkRuntime(options(), { exists: () => false });
    expect(result.unsupported).toBe(true);
    expect(result.error).toMatch(/can't run here/);
  });

  it("checks a signed macOS build by its signature and team", () => {
    const deps = {
      exists: () => true,
      hash: () => "anything",
      teamOf: (file: string) => (file.includes("evil") ? "OTHER" : "TEAM1"),
      codesignValid: () => true,
    };
    const mac = {
      ...options(),
      platform: "darwin",
      lockPath,
      appBundle: "/Applications/Termix.app",
    };
    fs.writeFileSync(
      lockPath + ".mac",
      JSON.stringify({ version: "1", files: { "darwin-x64": { node: "x" } } }),
    );
    expect(
      checkRuntime({ ...mac, lockPath: lockPath + ".mac" }, deps).error,
    ).toBeUndefined();
    expect(
      checkRuntime(
        { ...mac, lockPath: lockPath + ".mac" },
        { ...deps, codesignValid: () => false },
      ).error,
    ).toMatch(/not signed/);
  });
});

describe("runtime hash", () => {
  it("is the same for a PE file before and after signing", () => {
    const dir = fs.mkdtempSync(path.join(base, "pe-"));
    const unsigned = path.join(dir, "a.exe");
    const signed = path.join(dir, "b.exe");
    fs.writeFileSync(unsigned, fakePe(null));
    fs.writeFileSync(signed, fakePe(Buffer.alloc(40, 7), 0x1234));
    expect(peRanges(fs.readFileSync(signed))).not.toBeNull();
    expect(runtimeHash(signed)).toBe(runtimeHash(unsigned));
    expect(runtimeHash(signed).startsWith("pe:")).toBe(true);
  });

  it("changes when the code changes", () => {
    const dir = fs.mkdtempSync(path.join(base, "pe-"));
    const a = path.join(dir, "a.exe");
    const b = path.join(dir, "b.exe");
    fs.writeFileSync(a, fakePe(null));
    const changed = fakePe(null);
    changed[0x300] = 0x22;
    fs.writeFileSync(b, changed);
    expect(runtimeHash(a)).not.toBe(runtimeHash(b));
  });

  it("hashes other files as they are", () => {
    const file = path.join(base, "plain");
    fs.writeFileSync(file, "abc");
    expect(runtimeHash(file)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
