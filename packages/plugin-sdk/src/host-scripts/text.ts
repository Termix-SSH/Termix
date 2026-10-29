/**
 * Quoting, encoding and the error type the host scripts share.
 *
 * No Node APIs here: this entry also runs in the mobile app.
 */

/** A bad input to a host script builder. `status` is the HTTP status to answer with. */
export class HostScriptError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HostScriptError";
  }
}

/** Wraps a value in single quotes for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Written by hand because some JS engines (Hermes) have no TextDecoder.

/** UTF-8 bytes of a string. */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

/** A string from UTF-8 bytes. Bad sequences become U+FFFD. */
export function utf8Decode(bytes: ArrayLike<number>): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let need = 0;
    let cp = 0;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0) [need, cp] = [1, b & 31];
    else if (b >= 0xe0 && b < 0xf0) [need, cp] = [2, b & 15];
    else if (b >= 0xf0 && b < 0xf5) [need, cp] = [3, b & 7];
    else {
      out += "\ufffd";
      i++;
      continue;
    }
    let j = 1;
    for (; j <= need; j++) {
      const next = bytes[i + j];
      if (next === undefined || (next & 0xc0) !== 0x80) break;
      cp = (cp << 6) | (next & 63);
    }
    const tooSmall = [0, 0x80, 0x800, 0x10000][need];
    if (
      j <= need ||
      cp < tooSmall ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp < 0xe000)
    ) {
      out += "\ufffd";
      i += Math.max(1, j);
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 of the UTF-8 bytes of a string, for `base64 -d` on the host. */
export function toBase64(text: string): string {
  const bytes = utf8Encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

/** Reads key=value lines. Only the first = splits a line. */
export function parseKeys(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Trims output and keeps it short enough to show. */
export function scrub(text: string, max = 600): string {
  return text.trim().slice(0, max);
}
