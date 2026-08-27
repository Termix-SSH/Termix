import { beforeEach, describe, expect, it } from "vitest";
import { readHiddenRailTabs } from "../../sidebar/hidden-rail-tabs";

describe("readHiddenRailTabs", () => {
  beforeEach(() => localStorage.clear());

  it("returns stored tab identifiers", () => {
    localStorage.setItem("hiddenRailTabs", JSON.stringify(["ai", "hosts"]));
    expect([...readHiddenRailTabs()]).toEqual(["ai", "hosts"]);
  });

  it("recovers from malformed or non-list storage", () => {
    localStorage.setItem("hiddenRailTabs", "{broken");
    expect(readHiddenRailTabs().size).toBe(0);
    localStorage.setItem("hiddenRailTabs", JSON.stringify({ ai: true }));
    expect(readHiddenRailTabs().size).toBe(0);
  });
});
