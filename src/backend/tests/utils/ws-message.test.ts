import { describe, it, expect } from "vitest";
import {
  parseWsMessage,
  asObject,
  asString,
  toTerminalDimension,
  WsMessageError,
} from "../../utils/ws-message.js";

const frame = (s: string) => Buffer.from(s, "utf8");

describe("parseWsMessage", () => {
  it("parses a well-formed message", () => {
    expect(parseWsMessage(frame('{"type":"ping"}'))).toEqual({
      type: "ping",
      data: undefined,
    });
    expect(parseWsMessage(frame('{"type":"input","data":"ls"}'))).toEqual({
      type: "input",
      data: "ls",
    });
  });

  it("rejects JSON that parses but cannot be destructured", () => {
    // The original DoS: JSON.parse("null") succeeds, so it escaped the
    // try/catch and threw a TypeError on destructure.
    for (const payload of ["null", "123", '"str"', "[1,2]", "true"]) {
      expect(() => parseWsMessage(frame(payload))).toThrow(WsMessageError);
    }
  });

  it("rejects invalid JSON", () => {
    expect(() => parseWsMessage(frame("{oops"))).toThrow(WsMessageError);
    expect(() => parseWsMessage(frame(""))).toThrow(WsMessageError);
  });

  it("rejects a missing or non-string type", () => {
    expect(() => parseWsMessage(frame("{}"))).toThrow(WsMessageError);
    expect(() => parseWsMessage(frame('{"type":5}'))).toThrow(WsMessageError);
    expect(() => parseWsMessage(frame('{"type":null}'))).toThrow(
      WsMessageError,
    );
  });

  it("rejects oversized frames", () => {
    const huge = Buffer.alloc(1024 * 1024 + 1, 0x20);
    expect(() => parseWsMessage(huge)).toThrow(WsMessageError);
  });

  it("never throws a TypeError for any malformed input", () => {
    const payloads = [
      "null",
      "0",
      "[]",
      "{}",
      '{"type":{}}',
      '{"data":"x"}',
      "undefined",
      '{"type":"a","data":null}',
    ];
    for (const p of payloads) {
      try {
        parseWsMessage(frame(p));
      } catch (e) {
        expect(e).toBeInstanceOf(WsMessageError);
      }
    }
  });
});

describe("asObject / asString", () => {
  it("narrows without throwing", () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject(null)).toEqual({});
    expect(asObject([1])).toEqual({});
    expect(asObject("x")).toEqual({});
    expect(asString("x")).toBe("x");
    expect(asString(5)).toBe("");
    expect(asString(undefined)).toBe("");
  });
});

describe("toTerminalDimension", () => {
  it("accepts sane values", () => {
    expect(toTerminalDimension(80)).toBe(80);
    expect(toTerminalDimension("120")).toBe(120);
    expect(toTerminalDimension(24.7)).toBe(24);
  });

  it("rejects values that would poison setWindow", () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, "abc", {}]) {
      expect(toTerminalDimension(bad)).toBe(0);
    }
  });

  it("clamps absurdly large values", () => {
    expect(toTerminalDimension(1e9)).toBe(10000);
  });
});
