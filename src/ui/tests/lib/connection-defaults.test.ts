import { describe, expect, it } from "vitest";
import {
  parseRemoteDesktopDefaults,
  parseTerminalDefaults,
  resolveConnectionDefaults,
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
});
