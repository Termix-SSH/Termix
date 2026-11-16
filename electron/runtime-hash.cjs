// Hashes of the plugin runtime binaries. Code signing rewrites a file, so a
// Windows PE file is hashed without its checksum and signature (the parts
// Authenticode itself leaves out), and other files as they are. macOS
// builds that are signed are checked with codesign instead (plugin-runtime.cjs).

const crypto = require("crypto");
const fs = require("fs");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Byte ranges of a PE file that signing leaves alone, or null. */
function peRanges(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = buffer.readUInt32LE(0x3c);
  if (pe + 24 > buffer.length || buffer.readUInt32LE(pe) !== 0x4550) {
    return null;
  }
  const optional = pe + 24;
  const magic = buffer.readUInt16LE(optional);
  const directories =
    magic === 0x10b ? optional + 96 : magic === 0x20b ? optional + 112 : -1;
  if (directories < 0) return null;
  const checksum = optional + 64;
  const certEntry = directories + 4 * 8;
  if (certEntry + 8 > buffer.length) return null;
  const certStart = buffer.readUInt32LE(certEntry);
  const certSize = buffer.readUInt32LE(certEntry + 4);
  let end =
    certSize > 0 && certStart > certEntry && certStart <= buffer.length
      ? certStart
      : buffer.length;
  // Signing pads the file to 8 bytes before the signature. Trailing zeros
  // are left out either way so a signed and an unsigned copy match.
  for (let i = 0; i < 7 && end > certEntry + 8 && buffer[end - 1] === 0; i++) {
    end--;
  }
  const ranges = [
    [0, checksum],
    [checksum + 4, certEntry],
    [certEntry + 8, end],
  ];
  if (certSize > 0 && certStart + certSize < buffer.length) {
    ranges.push([certStart + certSize, buffer.length]);
  }
  return ranges;
}

/** The hash the lock file keeps for a runtime binary. */
function runtimeHash(file) {
  const buffer = fs.readFileSync(file);
  const ranges = peRanges(buffer);
  if (!ranges) return sha256(buffer);
  const hash = crypto.createHash("sha256");
  for (const [from, to] of ranges) hash.update(buffer.subarray(from, to));
  return `pe:${hash.digest("hex")}`;
}

module.exports = { runtimeHash, peRanges };
