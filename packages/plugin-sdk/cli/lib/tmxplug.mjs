import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** What a .tmxplug holds, in the order the spec lists it. */
export const TMXPLUG_CONTENTS = [
  "manifest.json",
  "dist",
  "locales",
  "migrations",
  "README.md",
  "CHANGELOG.md",
  "icon.svg",
];

const BLOCK = 512;

/**
 * Every file under the given top-level entries, as sorted posix paths.
 * Directories are implied by their files, so none get their own entry.
 */
export function collectFiles(cwd, entries = TMXPLUG_CONTENTS) {
  const files = [];
  const walk = (rel) => {
    const full = path.join(cwd, rel);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      throw new Error(`${rel} is a symlink; a .tmxplug holds plain files only`);
    }
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(full)) {
        walk(path.posix.join(rel, child));
      }
    } else if (stat.isFile()) {
      files.push(rel);
    }
  };
  for (const entry of entries) {
    if (fs.existsSync(path.join(cwd, entry))) walk(entry);
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function writeString(buf, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`"${value}" is too long`);
  bytes.copy(buf, offset);
}

function writeOctal(buf, offset, length, value) {
  writeString(buf, offset, length, value.toString(8).padStart(length - 1, "0"));
}

function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let i = name.length - 1; i > 0; i--) {
    if (name[i] !== "/") continue;
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new Error(`${name} is too long for a .tmxplug entry`);
}

function header(name, size) {
  const buf = Buffer.alloc(BLOCK);
  const split = splitName(name);
  writeString(buf, 0, 100, split.name);
  writeOctal(buf, 100, 8, 0o644);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  buf[156] = 0x30;
  writeString(buf, 257, 6, "ustar");
  writeString(buf, 263, 2, "00");
  writeString(buf, 345, 155, split.prefix);
  let sum = 0;
  for (const byte of buf) sum += byte;
  writeString(buf, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return buf;
}

/**
 * A gzipped ustar archive that depends only on file names and contents:
 * fixed mode, owner and mtime, sorted entries, and a gzip header with no
 * timestamp and a fixed OS byte (Node on Windows writes a different one).
 * Rebuilding from the same tag gives the same sha256 on any machine.
 */
export function createTmxplug(cwd, files) {
  const parts = [];
  for (const rel of files) {
    const data = fs.readFileSync(path.join(cwd, rel));
    parts.push(header(rel, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  const gz = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
  gz.writeUInt32LE(0, 4);
  gz[9] = 0x03;
  return gz;
}
