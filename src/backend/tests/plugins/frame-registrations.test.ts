import { describe, expect, it } from "vitest";
import {
  MAX_ENTRY_BYTES,
  cleanEntry,
  parseEntry,
} from "../../plugins/frame-registrations.js";

const entry = (size = 0) => ({
  version: "v1:g",
  live: [],
  registrations: [{ rid: "a#1", kind: "panel", raw: "x".repeat(size) }],
});

describe("frame registration entries", () => {
  it("drops extra fields like answers and values", () => {
    expect(
      JSON.parse(cleanEntry({ ...entry(), answers: { a: 1 }, values: {} })!),
    ).toEqual(entry());
  });

  it("refuses an entry over its cap", () => {
    expect(cleanEntry(entry(MAX_ENTRY_BYTES))).toBeNull();
  });

  it("refuses bad shapes", () => {
    expect(cleanEntry(null)).toBeNull();
    expect(cleanEntry({ ...entry(), version: "" })).toBeNull();
    expect(cleanEntry({ ...entry(), live: [1] })).toBeNull();
    expect(
      cleanEntry({ ...entry(), registrations: [{ rid: "a" }] }),
    ).toBeNull();
  });

  it("reads back only well formed rows", () => {
    expect(parseEntry(JSON.stringify(entry()))).toEqual(entry());
    expect(parseEntry("not json")).toBeNull();
    expect(parseEntry(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
