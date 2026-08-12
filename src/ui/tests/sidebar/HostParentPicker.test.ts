import { describe, expect, it } from "vitest";
import { collectDescendantIds } from "../../sidebar/HostParentPicker.js";
import type { Host } from "@/types/ui-types";

function host(id: string, parentHostId?: string): Host {
  return { id, parentHostId: parentHostId ?? null } as Host;
}

describe("collectDescendantIds", () => {
  it("returns an empty set for a host with no children", () => {
    const hosts = [host("1")];
    expect(collectDescendantIds("1", hosts)).toEqual(new Set());
  });

  it("collects direct children", () => {
    const hosts = [host("1"), host("2", "1"), host("3", "1")];
    expect(collectDescendantIds("1", hosts)).toEqual(new Set(["2", "3"]));
  });

  it("collects grandchildren at unlimited depth", () => {
    const hosts = [host("1"), host("2", "1"), host("3", "2"), host("4", "3")];
    expect(collectDescendantIds("1", hosts)).toEqual(new Set(["2", "3", "4"]));
  });

  it("does not include unrelated hosts or ancestors", () => {
    const hosts = [
      host("1"),
      host("2", "1"),
      host("3"), // unrelated sibling tree
      host("4", "3"),
    ];
    expect(collectDescendantIds("1", hosts)).toEqual(new Set(["2"]));
  });

  it("does not loop forever on a cyclic parent chain", () => {
    // Defensive case: two hosts pointing at each other should not hang.
    const hosts = [host("1", "2"), host("2", "1")];
    const result = collectDescendantIds("1", hosts);
    expect(result).toEqual(new Set(["2", "1"]));
  });
});
