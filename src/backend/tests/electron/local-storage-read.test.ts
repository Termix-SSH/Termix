import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  readOriginStorage,
  snappyDecompress,
} = require("../../../../electron/local-storage-read.cjs");

function varint(n: number): Buffer {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

// The way Chromium writes them: a format byte, then Latin-1 or UTF-16LE.
const latin1 = (s: string) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(s, "latin1")]);
const utf16 = (s: string) =>
  Buffer.concat([Buffer.from([0]), Buffer.from(s, "utf16le")]);
const storageKey = (origin: string, key: Buffer) =>
  Buffer.concat([Buffer.from(`_${origin}`), Buffer.from([0]), key]);

type Write = { key: Buffer; value: Buffer | null };

/** One write-ahead log record holding one batch. */
function logFile(sequence: bigint, writes: Write[]): Buffer {
  const head = Buffer.alloc(12);
  head.writeBigUInt64LE(sequence, 0);
  head.writeUInt32LE(writes.length, 8);
  const batch = Buffer.concat([
    head,
    ...writes.map(({ key, value }) =>
      value
        ? Buffer.concat([
            Buffer.from([1]),
            varint(key.length),
            key,
            varint(value.length),
            value,
          ])
        : Buffer.concat([Buffer.from([0]), varint(key.length), key]),
    ),
  ]);
  const header = Buffer.alloc(7);
  header.writeUInt16LE(batch.length, 4);
  header[6] = 1;
  return Buffer.concat([header, batch]);
}

/** Snappy with literals only, which every decoder must read. */
function snappyLiteral(data: Buffer): Buffer {
  const parts = [varint(data.length)];
  for (let i = 0; i < data.length; i += 256) {
    const chunk = data.subarray(i, i + 256);
    parts.push(Buffer.from([60 << 2, chunk.length - 1]), chunk);
  }
  return Buffer.concat(parts);
}

function block(entries: Array<[Buffer, Buffer]>): Buffer {
  const restart = Buffer.alloc(8);
  restart.writeUInt32LE(0, 0);
  restart.writeUInt32LE(1, 4);
  return Buffer.concat([
    ...entries.map(([key, value]) =>
      Buffer.concat([
        varint(0),
        varint(key.length),
        varint(value.length),
        key,
        value,
      ]),
    ),
    restart,
  ]);
}

/** A table with one data block. */
function tableFile(
  rows: Array<Write & { sequence: bigint }>,
  compress: boolean,
): Buffer {
  const data = block(
    rows.map(({ key, value, sequence }) => {
      const trailer = Buffer.alloc(8);
      trailer.writeBigUInt64LE((sequence << 8n) | (value ? 1n : 0n));
      return [Buffer.concat([key, trailer]), value ?? Buffer.alloc(0)];
    }),
  );
  const stored = compress ? snappyLiteral(data) : data;
  const trailer = Buffer.from([compress ? 1 : 0, 0, 0, 0, 0]);
  const index = block([
    [Buffer.from("z"), Buffer.concat([varint(0), varint(stored.length)])],
  ]);
  const indexOffset = stored.length + 5;
  const footer = Buffer.alloc(48);
  Buffer.concat([
    varint(0),
    varint(0),
    varint(indexOffset),
    varint(index.length),
  ]).copy(footer);
  Buffer.from("57fb808b247547db", "hex").copy(footer, 40);
  return Buffer.concat([
    stored,
    trailer,
    index,
    Buffer.from([0, 0, 0, 0, 0]),
    footer,
  ]);
}

const dirs: string[] = [];
function storeWith(files: Record<string, Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-ls-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const read = (dir: string, origin = "file://") =>
  Object.fromEntries(readOriginStorage({ dir, origin, fs, path }));

describe("readOriginStorage", () => {
  it("reads an origin's keys from the log", () => {
    const dir = storeWith({
      "000003.log": logFile(5n, [
        { key: storageKey("file://", latin1("theme")), value: latin1("dark") },
        { key: storageKey("file://", utf16("名前")), value: utf16("値") },
        { key: storageKey("https://other", latin1("x")), value: latin1("1") },
        { key: Buffer.from("META:file://"), value: Buffer.from([8, 1]) },
      ]),
    });
    expect(read(dir)).toEqual({ theme: "dark", 名前: "値" });
  });

  it("reads tables, plain and snappy, and lets the newest write win", () => {
    const key = (name: string) => storageKey("file://", latin1(name));
    const dir = storeWith({
      "000005.ldb": tableFile(
        [
          { key: key("font"), value: latin1("old"), sequence: 2n },
          { key: key("gone"), value: latin1("here"), sequence: 3n },
          { key: key("kept"), value: latin1("a".repeat(600)), sequence: 4n },
        ],
        true,
      ),
      "000007.ldb": tableFile(
        [{ key: key("lang"), value: latin1("de"), sequence: 6n }],
        false,
      ),
      "000009.log": logFile(10n, [
        { key: key("font"), value: latin1("new") },
        { key: key("gone"), value: null },
      ]),
    });
    expect(read(dir)).toEqual({
      font: "new",
      kept: "a".repeat(600),
      lang: "de",
    });
  });

  it("gives nothing for a missing folder and skips a damaged file", () => {
    expect(read(path.join(os.tmpdir(), "termix-ls-not-there"))).toEqual({});
    const good = logFile(1n, [
      { key: storageKey("file://", latin1("a")), value: latin1("1") },
    ]);
    const dir = storeWith({
      "000002.ldb": Buffer.concat([
        Buffer.alloc(60, 0xff),
        Buffer.from("57fb808b247547db", "hex"),
      ]),
      "000003.log": good,
      "000004.log": good.subarray(0, 9),
    });
    expect(read(dir)).toEqual({ a: "1" });
  });
});

describe("snappyDecompress", () => {
  it("expands literals and copies", () => {
    const packed = Buffer.from([12, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x11, 4]);
    expect(snappyDecompress(packed).toString()).toBe("abcdabcdabcd");
  });

  it("refuses a copy from before the start", () => {
    expect(() => snappyDecompress(Buffer.from([8, 0x11, 4]))).toThrow();
  });
});
