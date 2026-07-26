import { describe, expect, it } from "vitest";
import {
  parseCustomKeybindings,
  parseCustomThemes,
} from "../../api/open-tabs-api";

describe("parseCustomKeybindings", () => {
  it("parses a valid JSON array", () => {
    const raw = JSON.stringify([
      {
        id: "kb-1",
        combo: {
          key: "c",
          isCode: false,
          ctrl: true,
          alt: false,
          shift: false,
          meta: false,
        },
        action: { type: "copy" },
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const result = parseCustomKeybindings(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kb-1");
  });

  it("returns an empty array for null or undefined input", () => {
    expect(parseCustomKeybindings(null)).toEqual([]);
    expect(parseCustomKeybindings(undefined)).toEqual([]);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseCustomKeybindings("{not json")).toEqual([]);
  });

  it("returns an empty array when the JSON is not an array", () => {
    expect(parseCustomKeybindings(JSON.stringify({ foo: "bar" }))).toEqual([]);
  });
});

describe("parseCustomThemes", () => {
  it("still parses a valid JSON array (regression check)", () => {
    const raw = JSON.stringify([{ id: "t1", name: "My Theme", colors: {} }]);
    expect(parseCustomThemes(raw)).toHaveLength(1);
  });
});
