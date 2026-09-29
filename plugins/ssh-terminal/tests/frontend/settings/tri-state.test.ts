import { describe, expect, it } from "vitest";
import {
  fromTriState,
  toTriState,
} from "../../../src/frontend/settings/tri-state";

describe("tri-state", () => {
  it("keeps unset booleans distinct from false", () => {
    expect(toTriState(undefined)).toBe("inherit");
    expect(toTriState(true)).toBe("on");
    expect(toTriState(false)).toBe("off");

    expect(fromTriState("inherit")).toBeUndefined();
    expect(fromTriState("on")).toBe(true);
    expect(fromTriState("off")).toBe(false);
  });
});
