/**
 * The desktop plugin channel: length prefixed v8 frames over stdio.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  decodeWire,
  encodeFrame,
  encodeWire,
  FrameReader,
  MAX_FRAME,
  stdioTransport,
} from "../../../plugins/sandbox/frames.js";
import type { Wire } from "../../../plugins/sandbox/rpc.js";

describe("frames", () => {
  it("round trips messages with buffers and errors", () => {
    const message = {
      t: "ok",
      id: 1,
      v: { data: Buffer.from([1, 2]), when: new Date(0), err: new Error("x") },
    } as Wire;
    const frame = encodeWire(message);
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    const back = decodeWire(frame.subarray(4)) as {
      v: Record<string, unknown>;
    };
    expect(Buffer.from(back.v.data as Uint8Array)).toEqual(Buffer.from([1, 2]));
    expect((back.v.err as Error).message).toBe("x");
  });

  it("splits frames however the bytes arrive", () => {
    const got: string[] = [];
    const reader = new FrameReader(
      (p) => got.push(p.toString()),
      () => {},
    );
    const both = Buffer.concat([
      encodeFrame(Buffer.from("one")),
      encodeFrame(Buffer.from("two")),
    ]);
    for (const byte of both) reader.push(Buffer.from([byte]));
    reader.push(Buffer.concat([both, encodeFrame(Buffer.from(""))]));
    expect(got).toEqual(["one", "two", "one", "two", ""]);
  });

  it("stops at a frame over the limit and reads nothing after it", () => {
    const onFrame = vi.fn();
    const onError = vi.fn();
    const reader = new FrameReader(onFrame, onError, 8);
    reader.push(encodeFrame(Buffer.alloc(9)));
    reader.push(encodeFrame(Buffer.from("ok")));
    expect(onError).toHaveBeenCalledOnce();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("refuses to write a frame over the limit", () => {
    expect(() =>
      encodeFrame({ length: MAX_FRAME + 1 } as unknown as Uint8Array),
    ).toThrow(/too large/);
  });

  it("gives the child a transport and ends it when the app goes away", () => {
    const input = new PassThrough();
    const written: Buffer[] = [];
    const closed = vi.fn();
    const transport = stdioTransport(
      input,
      { write: (b: Buffer) => written.push(b) > 0 },
      closed,
    );
    const got: Wire[] = [];
    transport.onMessage((m) => got.push(m));
    input.write(encodeWire({ t: "rel", f: "a" }));
    transport.send({ t: "rel", f: "b" });
    expect(decodeWire(written[0].subarray(4))).toEqual({ t: "rel", f: "b" });
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(got).toEqual([{ t: "rel", f: "a" }]);
        input.end();
        setImmediate(() => {
          expect(closed).toHaveBeenCalled();
          resolve();
        });
      });
    });
  });
});
