// Reads what an origin saved in localStorage straight from Chromium's LevelDB
// files. Builds before 26.11.2 ran the UI on file://, and with the file
// protocol fuse off no page may open that storage any more, so the main
// process reads the files itself. Read only, pure JS, no page involved.

const BLOCK_SIZE = 32768;
const TABLE_MAGIC = Buffer.from("57fb808b247547db", "hex");
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function varint(buf, pos) {
  let result = 0;
  let shift = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error("varint past the end");
    const byte = buf[pos++];
    result += (byte & 0x7f) * shift;
    if (!(byte & 0x80)) return [result, pos];
    shift *= 128;
  }
  throw new Error("varint too long");
}

function snappyDecompress(buf) {
  let [length, p] = varint(buf, 0);
  if (length > MAX_FILE_BYTES) throw new Error("snappy block too large");
  const out = Buffer.alloc(length);
  let o = 0;
  while (p < buf.length) {
    const tag = buf[p++];
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = 0;
        for (let i = 0; i < bytes; i++) len += buf[p++] * 2 ** (8 * i);
      }
      len += 1;
      if (p + len > buf.length || o + len > length) {
        throw new Error("snappy literal past the end");
      }
      buf.copy(out, o, p, p + len);
      p += len;
      o += len;
      continue;
    }
    let len;
    let offset;
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | buf[p++];
    } else if (kind === 2) {
      len = (tag >> 2) + 1;
      offset = buf[p] | (buf[p + 1] << 8);
      p += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = buf.readUInt32LE(p);
      p += 4;
    }
    if (offset === 0 || offset > o || o + len > length) {
      throw new Error("snappy copy out of range");
    }
    for (let i = 0; i < len; i++, o++) out[o] = out[o - offset];
  }
  if (o !== length) throw new Error("snappy block is short");
  return out;
}

function readBlock(file, offset, size) {
  if (offset + size + 1 > file.length) throw new Error("block past the end");
  const raw = file.subarray(offset, offset + size);
  const type = file[offset + size];
  if (type === 0) return raw;
  if (type === 1) return snappyDecompress(raw);
  throw new Error("unknown block compression");
}

/** Calls each(key, value) for every entry of a table block. */
function eachBlockEntry(block, each) {
  if (block.length < 4) return;
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - restarts * 4;
  if (end < 0) throw new Error("bad block restarts");
  let pos = 0;
  let key = Buffer.alloc(0);
  while (pos < end) {
    let shared;
    let unshared;
    let valueLength;
    [shared, pos] = varint(block, pos);
    [unshared, pos] = varint(block, pos);
    [valueLength, pos] = varint(block, pos);
    if (shared > key.length || pos + unshared + valueLength > end) {
      throw new Error("bad block entry");
    }
    key = Buffer.concat([
      key.subarray(0, shared),
      block.subarray(pos, pos + unshared),
    ]);
    pos += unshared;
    each(key, block.subarray(pos, pos + valueLength));
    pos += valueLength;
  }
}

/** Entries of one .ldb table: each(userKey, sequence, value or null). */
function readTable(file, each) {
  if (file.length < 48) return;
  const footer = file.subarray(file.length - 48);
  if (!footer.subarray(40).equals(TABLE_MAGIC)) return;
  let pos = 0;
  [, pos] = varint(footer, pos);
  [, pos] = varint(footer, pos);
  let indexOffset;
  let indexSize;
  [indexOffset, pos] = varint(footer, pos);
  [indexSize, pos] = varint(footer, pos);
  eachBlockEntry(readBlock(file, indexOffset, indexSize), (_key, handle) => {
    const [offset, next] = varint(handle, 0);
    const [size] = varint(handle, next);
    eachBlockEntry(readBlock(file, offset, size), (key, value) => {
      if (key.length < 8) return;
      const trailer = key.readBigUInt64LE(key.length - 8);
      const type = Number(trailer & 0xffn);
      each(
        key.subarray(0, key.length - 8),
        trailer >> 8n,
        type === 1 ? value : null,
      );
    });
  });
}

function readBatch(batch, each) {
  if (batch.length < 12) return;
  const sequence = batch.readBigUInt64LE(0);
  const count = batch.readUInt32LE(8);
  let pos = 12;
  for (let i = 0; i < count && pos < batch.length; i++) {
    const type = batch[pos++];
    let length;
    [length, pos] = varint(batch, pos);
    const key = batch.subarray(pos, pos + length);
    pos += length;
    let value = null;
    if (type === 1) {
      [length, pos] = varint(batch, pos);
      value = batch.subarray(pos, pos + length);
      pos += length;
    } else if (type !== 0) {
      return;
    }
    if (pos > batch.length) return;
    each(key, sequence + BigInt(i), value);
  }
}

/** Entries of one write-ahead .log file, same callback as readTable. */
function readLog(file, each) {
  let record = [];
  for (let start = 0; start < file.length; start += BLOCK_SIZE) {
    const blockEnd = Math.min(start + BLOCK_SIZE, file.length);
    let pos = start;
    while (pos + 7 <= blockEnd) {
      const length = file.readUInt16LE(pos + 4);
      const type = file[pos + 6];
      // Zeroed space at the end of a log.
      if (type === 0 && length === 0) break;
      const dataEnd = pos + 7 + length;
      if (dataEnd > blockEnd) break;
      const data = file.subarray(pos + 7, dataEnd);
      pos = dataEnd;
      if (type === 1) {
        readBatch(data, each);
        record = [];
      } else if (type === 2) {
        record = [data];
      } else if (type === 3) {
        record.push(data);
      } else if (type === 4) {
        record.push(data);
        readBatch(Buffer.concat(record), each);
        record = [];
      }
    }
  }
}

/** Chromium stores a string as one format byte, then UTF-16LE or Latin-1. */
function decodeString(buf) {
  if (buf.length === 0) return null;
  if (buf[0] === 0) return buf.subarray(1).toString("utf16le");
  if (buf[0] === 1) return buf.subarray(1).toString("latin1");
  return null;
}

/**
 * Returns the [key, value] pairs an origin saved, newest write of each key.
 * A file that is missing or damaged is skipped, so a broken store gives fewer
 * entries and never throws.
 */
function readOriginStorage({ dir, origin, fs, path, log = () => {} }) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = Buffer.concat([
    Buffer.from(`_${origin}`, "latin1"),
    Buffer.from([0]),
  ]);
  const newest = new Map();
  const each = (key, sequence, value) => {
    if (key.length <= prefix.length) return;
    if (!key.subarray(0, prefix.length).equals(prefix)) return;
    const id = key.subarray(prefix.length).toString("latin1");
    const seen = newest.get(id);
    if (seen && seen.sequence >= sequence) return;
    newest.set(id, { sequence, value: value ? Buffer.from(value) : null });
  };
  for (const name of names) {
    const table = name.endsWith(".ldb") || name.endsWith(".sst");
    if (!table && !name.endsWith(".log")) continue;
    try {
      const full = path.join(dir, name);
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
      const file = fs.readFileSync(full);
      if (table) readTable(file, each);
      else readLog(file, each);
    } catch (error) {
      log(`Skipped ${name}: ${error?.message || String(error)}`);
    }
  }
  const entries = [];
  for (const [id, { value }] of newest) {
    if (!value) continue;
    const key = decodeString(Buffer.from(id, "latin1"));
    const text = decodeString(value);
    if (key !== null && text !== null) entries.push([key, text]);
  }
  return entries;
}

module.exports = { readOriginStorage, snappyDecompress, decodeString };
