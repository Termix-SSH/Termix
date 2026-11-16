import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { forcedScaleFactor } = require("../../../../electron/linux-scale.cjs");

describe("forcedScaleFactor", () => {
  it("follows the system scale on GNOME and X11 (#1836)", () => {
    expect(
      forcedScaleFactor({
        XDG_CURRENT_DESKTOP: "ubuntu:GNOME",
        XDG_SESSION_TYPE: "wayland",
      }),
    ).toBeNull();
    expect(
      forcedScaleFactor({
        XDG_CURRENT_DESKTOP: "KDE",
        XDG_SESSION_TYPE: "x11",
      }),
    ).toBeNull();
    expect(forcedScaleFactor({})).toBeNull();
  });

  it("keeps 1 on KDE under Wayland", () => {
    expect(
      forcedScaleFactor({
        XDG_CURRENT_DESKTOP: "KDE",
        XDG_SESSION_TYPE: "wayland",
      }),
    ).toBe("1");
    expect(
      forcedScaleFactor({ XDG_CURRENT_DESKTOP: "KDE", WAYLAND_DISPLAY: "w-0" }),
    ).toBe("1");
  });

  it("takes a value set by hand", () => {
    expect(
      forcedScaleFactor({
        TERMIX_FORCE_DEVICE_SCALE_FACTOR: "2",
        XDG_CURRENT_DESKTOP: "KDE",
        XDG_SESSION_TYPE: "wayland",
      }),
    ).toBe("2");
    expect(forcedScaleFactor({ TERMIX_FORCE_DEVICE_SCALE_FACTOR: "1.5" })).toBe(
      "1.5",
    );
  });

  it("ignores a bad value", () => {
    expect(
      forcedScaleFactor({ TERMIX_FORCE_DEVICE_SCALE_FACTOR: "huge" }),
    ).toBeNull();
    expect(
      forcedScaleFactor({ TERMIX_FORCE_DEVICE_SCALE_FACTOR: "0" }),
    ).toBeNull();
  });
});
