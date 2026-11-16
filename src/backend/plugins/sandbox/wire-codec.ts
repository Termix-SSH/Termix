/**
 * Encodes RPC messages for the desktop plugin channel. Core runs on
 * Electron's V8 and the plugin on the app's pinned Node, so v8.serialize
 * can't be used: a newer V8 writes a format an older one refuses. This keeps
 * what crosses today (plain data, buffers, dates, errors, maps, sets,
 * undefined, bigints, odd numbers) in a form any Node reads.
 *
 * Payload: 4 byte length of a JSON tree, the JSON, then each binary blob as a
 * 4 byte length and its bytes. Special values in the tree are objects with
 * the TAG key; binary data is referenced by blob index.
 */

const TAG = "\u0001";

type Tagged = Record<string, unknown>;

function tag(kind: string, value?: unknown): Tagged {
  return value === undefined ? { [TAG]: kind } : { [TAG]: kind, v: value };
}

const TYPED: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
  Int8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
};

function encodeValue(value: unknown, blobs: Uint8Array[]): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "undefined":
      return tag("u");
    case "string":
    case "boolean":
      return value;
    case "number":
      if (Number.isNaN(value)) return tag("n", "NaN");
      if (value === Infinity) return tag("n", "Infinity");
      if (value === -Infinity) return tag("n", "-Infinity");
      if (Object.is(value, -0)) return tag("n", "-0");
      return value;
    case "bigint":
      return tag("i", value.toString());
    case "function":
    case "symbol":
      // v8.serialize refuses these; the RPC layer turns functions into ids
      // before a message gets here.
      throw new TypeError(`Cannot send a ${typeof value}`);
  }
  const object = value as object;
  if (object instanceof Uint8Array) {
    blobs.push(object);
    return tag(Buffer.isBuffer(object) ? "b" : "u8", blobs.length - 1);
  }
  if (ArrayBuffer.isView(object)) {
    const view = object as ArrayBufferView;
    blobs.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    const kind =
      object instanceof DataView ? "DataView" : object.constructor.name;
    return { [TAG]: "t", k: kind, v: blobs.length - 1 };
  }
  if (object instanceof ArrayBuffer) {
    blobs.push(new Uint8Array(object));
    return tag("ab", blobs.length - 1);
  }
  if (object instanceof Date) return tag("d", object.getTime());
  if (object instanceof RegExp) return tag("r", [object.source, object.flags]);
  if (object instanceof Error) {
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(object)) {
      fields[key] = encodeValue((object as never)[key], blobs);
    }
    return {
      [TAG]: "e",
      v: {
        name: object.name,
        message: object.message,
        stack: object.stack,
        fields,
      },
    };
  }
  if (object instanceof Map) {
    return tag(
      "m",
      [...object].map(([k, v]) => [
        encodeValue(k, blobs),
        encodeValue(v, blobs),
      ]),
    );
  }
  if (object instanceof Set) {
    return tag(
      "s",
      [...object].map((v) => encodeValue(v, blobs)),
    );
  }
  if (Array.isArray(object)) {
    return object.map((v) => encodeValue(v, blobs));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    out[key] = encodeValue((object as Record<string, unknown>)[key], blobs);
  }
  // An object that already uses the tag key is sent as entries.
  if (Object.prototype.hasOwnProperty.call(out, TAG)) {
    return tag("o", Object.entries(out));
  }
  return out;
}

function decodeValue(value: unknown, blobs: Buffer[]): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => decodeValue(v, blobs));
  const object = value as Tagged;
  const kind = object[TAG];
  if (typeof kind !== "string") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(object)) {
      out[key] = decodeValue(object[key], blobs);
    }
    return out;
  }
  const blob = (index: unknown) => {
    const data = blobs[Number(index)];
    if (!data) throw new Error("Bad message");
    return data;
  };
  switch (kind) {
    case "u":
      return undefined;
    case "n":
      return object.v === "-0" ? -0 : Number(object.v);
    case "i":
      return BigInt(String(object.v));
    case "b":
      return Buffer.from(blob(object.v));
    case "u8":
      return new Uint8Array(blob(object.v));
    case "ab": {
      return new Uint8Array(blob(object.v)).buffer;
    }
    case "t": {
      const data = blob(object.v);
      // A fresh copy, so the typed array is aligned and owns its memory.
      const copy = new Uint8Array(data).buffer;
      if (object.k === "DataView") return new DataView(copy);
      const Typed = TYPED[String(object.k)];
      return Typed ? new Typed(copy) : new Uint8Array(copy);
    }
    case "d":
      return new Date(Number(object.v));
    case "r": {
      const [source, flags] = object.v as [string, string];
      return new RegExp(source, flags);
    }
    case "e": {
      const data = object.v as {
        name: string;
        message: string;
        stack?: string;
        fields: Record<string, unknown>;
      };
      const error = new Error(String(data.message));
      error.name = String(data.name);
      if (data.stack !== undefined) error.stack = String(data.stack);
      for (const [key, field] of Object.entries(data.fields ?? {})) {
        (error as unknown as Record<string, unknown>)[key] = decodeValue(
          field,
          blobs,
        );
      }
      return error;
    }
    case "m":
      return new Map(
        (object.v as [unknown, unknown][]).map(([k, v]) => [
          decodeValue(k, blobs),
          decodeValue(v, blobs),
        ]),
      );
    case "s":
      return new Set((object.v as unknown[]).map((v) => decodeValue(v, blobs)));
    case "o": {
      const out: Record<string, unknown> = {};
      for (const [key, field] of object.v as [string, unknown][]) {
        out[key] = decodeValue(field, blobs);
      }
      return out;
    }
    default:
      throw new Error("Bad message");
  }
}

export function encodePayload(message: unknown): Buffer {
  const blobs: Uint8Array[] = [];
  const json = Buffer.from(JSON.stringify(encodeValue(message, blobs)), "utf8");
  const parts: Uint8Array[] = [];
  const head = Buffer.alloc(4);
  head.writeUInt32BE(json.length, 0);
  parts.push(head, json);
  for (const blob of blobs) {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(blob.byteLength, 0);
    parts.push(size, blob);
  }
  return Buffer.concat(parts);
}

export function decodePayload(payload: Uint8Array): unknown {
  const data = Buffer.from(payload.buffer, payload.byteOffset, payload.length);
  if (data.length < 4) throw new Error("Bad message");
  const jsonLength = data.readUInt32BE(0);
  if (4 + jsonLength > data.length) throw new Error("Bad message");
  const tree = JSON.parse(data.subarray(4, 4 + jsonLength).toString("utf8"));
  const blobs: Buffer[] = [];
  let offset = 4 + jsonLength;
  while (offset < data.length) {
    if (offset + 4 > data.length) throw new Error("Bad message");
    const size = data.readUInt32BE(offset);
    offset += 4;
    if (offset + size > data.length) throw new Error("Bad message");
    blobs.push(data.subarray(offset, offset + size));
    offset += size;
  }
  return decodeValue(tree, blobs);
}
