import { describe, expect, it } from "vitest";
import { parseAsciicast } from "./asciicast";

describe("parseAsciicast", () => {
  it("parses terminal dimensions and timed input/output", () => {
    const recording = parseAsciicast(
      '{"version":2,"width":120,"height":30}\n[0.1,"o","hello"]\n[1.5,"i","ls\\r"]\n[2,"r","100x40"]\n',
    );
    expect(recording.width).toBe(120);
    expect(recording.height).toBe(30);
    expect(recording.duration).toBe(2);
    expect(recording.events).toHaveLength(3);
  });

  it("rejects unsupported recording versions", () => {
    expect(() => parseAsciicast('{"version":1}\n')).toThrow(
      "Unsupported asciicast version",
    );
  });
});
