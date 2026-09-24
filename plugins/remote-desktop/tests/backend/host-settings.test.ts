import { describe, expect, it } from "vitest";
import {
  normalizeImportedHost,
  userDefaultParams,
} from "../../src/backend/host-settings.js";

describe("normalizeImportedHost", () => {
  it("reads a Termix export's pluginSettings", () => {
    expect(
      normalizeImportedHost({
        pluginSettings: {
          "remote-desktop": {
            enableVnc: true,
            vncPort: 5901,
            guacamoleConfig: { cursor: "local" },
          },
        },
      }),
    ).toEqual({
      enableVnc: true,
      vncPort: 5901,
      guacamoleConfig: { cursor: "local" },
    });
  });

  it("reads the flat fields hosts had before 2.9.0", () => {
    expect(
      normalizeImportedHost({
        enableRdp: true,
        rdpPort: "3390",
        security: "nla",
        ignoreCert: 1,
        guacamoleConfig: JSON.stringify({ dpi: 120 }),
        enableTerminalToolbar: false,
      }),
    ).toEqual({
      enableRdp: true,
      rdpPort: 3390,
      rdpSecurity: "nla",
      rdpIgnoreCert: true,
      guacamoleConfig: { dpi: 120 },
      enableToolbar: false,
    });
  });

  it("turns a connectionType-only host into its switch and port", () => {
    expect(
      normalizeImportedHost({ connectionType: "telnet", port: 2323 }),
    ).toEqual({ enableTelnet: true, telnetPort: 2323 });
  });

  it("writes nothing for a plain SSH row", () => {
    expect(
      normalizeImportedHost({ connectionType: "ssh", port: 22 }),
    ).toBeNull();
  });

  it("drops a port out of range", () => {
    expect(normalizeImportedHost({ enableRdp: true, rdpPort: 70000 })).toEqual({
      enableRdp: true,
    });
  });
});

describe("userDefaultParams", () => {
  it("maps the user settings onto guacd parameters, skipping inherit", () => {
    expect(
      userDefaultParams({
        colorDepth: "24",
        resizeMethod: "reconnect",
        disableCopy: "on",
        enableWallpaper: "off",
        enableDrive: "inherit",
      }),
    ).toEqual({
      "color-depth": 24,
      "resize-method": "reconnect",
      "disable-copy": true,
      "enable-wallpaper": false,
    });
  });
});
