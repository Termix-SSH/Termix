import { describe, expect, it } from "vitest";
import { withDriveSettings } from "../../../hosts/guacamole/drive-settings.js";

describe("withDriveSettings", () => {
  it("gives each user a folder under GUACD_DRIVE_PATH and creates it", () => {
    expect(
      withDriveSettings({ "enable-drive": true }, "user-1", {
        GUACD_DRIVE_PATH: "/termix-data/rdp-drive/",
      }),
    ).toEqual({
      "enable-drive": true,
      "drive-path": "/termix-data/rdp-drive/user-1",
      "create-drive-path": true,
    });
  });

  it("falls back to /drive when the environment says nothing", () => {
    expect(
      withDriveSettings({ "enable-drive": true }, "user-1", {}),
    ).toMatchObject({ "drive-path": "/drive/user-1" });
  });

  it("leaves a host-chosen drive-path alone", () => {
    const config = { "enable-drive": true, "drive-path": "/mnt/share" };
    expect(
      withDriveSettings(config, "user-1", { GUACD_DRIVE_PATH: "/x" }),
    ).toBe(config);
  });

  it("does nothing when the drive is not enabled", () => {
    const config = { "enable-drive": false };
    expect(withDriveSettings(config, "user-1")).toBe(config);
  });
});
