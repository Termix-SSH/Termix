// The end of the app's own log, for the diagnostics report.

const MAX_BYTES = 64 * 1024;
const MAX_LINES = 400;

function readLogTail(
  fs,
  file,
  { maxBytes = MAX_BYTES, maxLines = MAX_LINES } = {},
) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    // A read that starts mid file starts mid line.
    if (start > 0) lines = lines.slice(1);
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { readLogTail };
