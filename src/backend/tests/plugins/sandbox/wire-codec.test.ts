/**
 * The desktop plugin channel's codec. Core and the plugin run different V8
 * versions there, so it must not depend on v8.serialize.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodePayload,
  encodePayload,
} from "../../../plugins/sandbox/wire-codec.js";

const roundTrip = (value: unknown) => decodePayload(encodePayload(value));

describe("wire codec", () => {
  it("keeps plain data and the values JSON can't hold", () => {
    const value = {
      text: "hi",
      n: 1.5,
      ok: true,
      none: null,
      missing: undefined,
      odd: [NaN, Infinity, -Infinity, -0],
      big: 12345678901234567890n,
      when: new Date(1000),
      pattern: /a+b/gi,
      list: [1, "two", { three: 3 }],
      map: new Map<unknown, unknown>([["k", new Set([1, 2])]]),
    };
    const back = roundTrip(value) as typeof value;
    expect(back).toEqual(value);
    expect(Object.is(back.odd[3], -0)).toBe(true);
    expect("missing" in back).toBe(true);
  });

  it("sends binary data as bytes and keeps its type", () => {
    const value = {
      buffer: Buffer.from("buffer"),
      bytes: new Uint8Array([1, 2, 3]),
      floats: new Float64Array([1.5, -2]),
      raw: new Uint8Array([9, 8]).buffer,
    };
    const back = roundTrip(value) as typeof value;
    expect(Buffer.isBuffer(back.buffer)).toBe(true);
    expect(back.buffer.toString()).toBe("buffer");
    expect(back.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(back.floats).toEqual(new Float64Array([1.5, -2]));
    expect(new Uint8Array(back.raw)).toEqual(new Uint8Array([9, 8]));
    // The bytes are not inflated into the JSON part.
    const big = encodePayload({ data: Buffer.alloc(1_000_000, 1) });
    expect(big.length).toBeLessThan(1_000_100);
  });

  it("keeps errors with their name, message, stack and fields", () => {
    const error = Object.assign(new TypeError("bad"), {
      code: "E_BAD",
      status: 400,
    });
    const back = roundTrip({ e: error }) as { e: Error & { code: string } };
    expect(back.e).toBeInstanceOf(Error);
    expect(back.e.name).toBe("TypeError");
    expect(back.e.message).toBe("bad");
    expect(back.e.code).toBe("E_BAD");
    expect(back.e.stack).toBe(error.stack);
  });

  it("does not mistake data for its own tags", () => {
    const value = { "\u0001": "u", other: 1 };
    expect(roundTrip(value)).toEqual(value);
  });

  it("refuses functions and broken payloads", () => {
    expect(() => encodePayload({ f: () => 1 })).toThrow();
    expect(() => decodePayload(Buffer.from([0, 0, 0, 9, 1]))).toThrow();
    const good = encodePayload({ b: Buffer.from("x") });
    expect(() => decodePayload(good.subarray(0, good.length - 1))).toThrow();
  });
});

const require = createRequire(import.meta.url);
const repo = path.resolve(__dirname, "../../../../..");
const { checkRuntime } = require(
  path.join(repo, "electron", "plugin-runtime.cjs"),
);
const runtime = checkRuntime({ isPackaged: false, appRoot: repo });

describe.runIf(!runtime.error)("wire codec across V8 versions", () => {
  const codec = pathToFileURL(
    path.join(repo, "src", "backend", "plugins", "sandbox", "wire-codec.ts"),
  ).href;
  const sample = {
    t: "ok",
    id: 7,
    v: { data: Buffer.from("from"), when: new Date(5), e: new Error("x") },
  };

  it("reads what the pinned Node writes, and the other way", () => {
    const write = spawnSync(
      runtime.node,
      [
        "--input-type=module",
        "-e",
        `const { encodePayload } = await import(${JSON.stringify(codec)});
         process.stdout.write(encodePayload({ t: "ok", id: 7, v: { data: Buffer.from("from"), when: new Date(5), e: new Error("x") } }).toString("base64"));`,
      ],
      { encoding: "utf8" },
    );
    expect(write.status, write.stderr).toBe(0);
    const back = decodePayload(Buffer.from(write.stdout, "base64")) as {
      v: { data: Buffer; when: Date; e: Error };
    };
    expect(back.v.data.toString()).toBe("from");
    expect(back.v.when.getTime()).toBe(5);
    expect(back.v.e.message).toBe("x");

    const read = spawnSync(
      runtime.node,
      [
        "--input-type=module",
        "-e",
        `const { decodePayload } = await import(${JSON.stringify(codec)});
         const v = decodePayload(Buffer.from(process.argv[1], "base64"));
         process.stdout.write(JSON.stringify([v.v.data.toString(), v.v.when.getTime(), v.v.e.message]));`,
        encodePayload(sample).toString("base64"),
      ],
      { encoding: "utf8" },
    );
    expect(read.status, read.stderr).toBe(0);
    expect(JSON.parse(read.stdout)).toEqual(["from", 5, "x"]);
  });
});
