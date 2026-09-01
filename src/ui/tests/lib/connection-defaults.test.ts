import { describe, expect, it } from "vitest";
import {
  fromTriState,
  parseRemoteDesktopDefaults,
  parseTerminalDefaults,
  resolveConnectionDefaults,
  toTriState,
} from "../../lib/connection-defaults";

describe("connection defaults", () => {
  it("ignores malformed persisted defaults", () => {
    expect(parseTerminalDefaults("not-json")).toEqual({});
    expect(parseRemoteDesktopDefaults("[]")).toEqual({});
  });

  it("lets host values override user defaults", () => {
    expect(
      resolveConnectionDefaults<{ fontSize: number; cursorBlink: boolean }>(
        { fontSize: 14, cursorBlink: true },
        { fontSize: 18 },
      ),
    ).toEqual({ fontSize: 18, cursorBlink: true });
  });

  it("keeps unset booleans distinct from false", () => {
    expect(toTriState(undefined)).toBe("inherit");
    expect(toTriState(true)).toBe("on");
    expect(toTriState(false)).toBe("off");

    expect(fromTriState("inherit")).toBeUndefined();
    expect(fromTriState("on")).toBe(true);
    expect(fromTriState("off")).toBe(false);
  });
});
