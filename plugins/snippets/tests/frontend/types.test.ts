import { describe, expect, it } from "vitest";
import { parseHostFilter } from "../../src/frontend/types";

describe("parseHostFilter", () => {
  it("reads a stored list of host ids", () => {
    expect(parseHostFilter("[1,5]")).toEqual([1, 5]);
  });

  it("treats empty, malformed or non-numeric values as no targets", () => {
    expect(parseHostFilter(null)).toEqual([]);
    expect(parseHostFilter("")).toEqual([]);
    expect(parseHostFilter("not json")).toEqual([]);
    expect(parseHostFilter('{"a":1}')).toEqual([]);
    expect(parseHostFilter('[1,"x",2]')).toEqual([1, 2]);
  });
});
