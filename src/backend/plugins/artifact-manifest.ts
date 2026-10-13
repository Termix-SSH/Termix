import path from "node:path";
import zlib from "node:zlib";
import * as tar from "tar";

const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/**
 * Reads every copy of one file out of a .tmxplug (a gzipped tar) without
 * unpacking it to disk. Uses the same tar parser as the loader's unpack, so
 * pax and long-name headers resolve the same way, and only plain files count
 * because they are the only kind the unpack writes. Names compare
 * case-insensitively since a case-insensitive disk folds them together.
 */
export function readArtifactFiles(buffer: Buffer, wanted: string): Buffer[] {
  const archive = zlib.gunzipSync(buffer, {
    maxOutputLength: MAX_UNPACKED_BYTES,
  });
  const key = wanted.toLowerCase();
  const found: Buffer[] = [];
  const parser = new tar.Parser({
    strict: true,
    onReadEntry: (entry) => {
      const name = path.posix.normalize(entry.path.replace(/\\/g, "/"));
      if (entry.type !== "File" || name.toLowerCase() !== key) {
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      entry.on("end", () => found.push(Buffer.concat(chunks)));
    },
  });
  // The parser runs synchronously on an in-memory buffer.
  parser.end(archive);
  return found;
}

/**
 * The manifest.json packed in a .tmxplug, parsed but not validated. An
 * archive with more than one is refused: the unpack keeps the last copy, so
 * whichever one this read the other could carry different capabilities.
 */
export function readArtifactManifest(buffer: Buffer): Record<string, unknown> {
  let copies: Buffer[];
  try {
    copies = readArtifactFiles(buffer, "manifest.json");
  } catch {
    throw new Error("the file is not a valid .tmxplug archive");
  }
  if (copies.length === 0) throw new Error("the archive has no manifest.json");
  if (copies.length > 1) {
    throw new Error("the archive has more than one manifest.json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(copies[0].toString("utf8"));
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("manifest.json is not an object");
  }
  return parsed as Record<string, unknown>;
}

/** Whether two capability lists name the same set, order ignored. */
export function sameCapabilities(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const capability of left) if (!right.has(capability)) return false;
  return true;
}
