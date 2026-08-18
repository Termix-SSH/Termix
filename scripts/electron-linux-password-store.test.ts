import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { selectLinuxPasswordStore } =
  require("../electron/linux-password-store.cjs") as {
    selectLinuxPasswordStore: (
      commandLine: {
        hasSwitch: (name: string) => boolean;
        appendSwitch: (name: string, value: string) => void;
      },
      env: NodeJS.ProcessEnv,
    ) => string | null;
  };

function commandLine(existing: string[] = []) {
  const appended: Array<[string, string]> = [];
  return {
    appended,
    hasSwitch: (name: string) => existing.includes(name),
    appendSwitch: vi.fn((name: string, value: string) =>
      appended.push([name, value]),
    ),
  };
}

describe("Linux password store selection", () => {
  it("names libsecret on desktops Chromium has no mapping for", () => {
    // Without this the backend resolves to "basic_text", and safeStorage
    // reports encryption as unavailable even though a keyring is running.
    for (const desktop of ["Hyprland", "sway", "niri", "river", "wayfire"]) {
      const cmd = commandLine();
      expect(
        selectLinuxPasswordStore(cmd, { XDG_CURRENT_DESKTOP: desktop }),
      ).toBe("gnome-libsecret");
      expect(cmd.appended).toEqual([["password-store", "gnome-libsecret"]]);
    }
  });

  it("leaves KWallet desktops to auto-detection", () => {
    for (const env of [
      { XDG_CURRENT_DESKTOP: "KDE" },
      { XDG_CURRENT_DESKTOP: "KDE", DESKTOP_SESSION: "plasma" },
      { DESKTOP_SESSION: "/usr/share/xsessions/plasma" },
      { XDG_CURRENT_DESKTOP: "LXQt" },
    ]) {
      const cmd = commandLine();
      expect(selectLinuxPasswordStore(cmd, env)).toBeNull();
      expect(cmd.appendSwitch).not.toHaveBeenCalled();
    }
  });

  it("never overrides a password store the user asked for", () => {
    const cmd = commandLine(["password-store"]);
    expect(
      selectLinuxPasswordStore(cmd, { XDG_CURRENT_DESKTOP: "Hyprland" }),
    ).toBeNull();
    expect(cmd.appendSwitch).not.toHaveBeenCalled();
  });

  it("selects libsecret when the desktop is unset, matching a bare session", () => {
    const cmd = commandLine();
    expect(selectLinuxPasswordStore(cmd, {})).toBe("gnome-libsecret");
  });
});
