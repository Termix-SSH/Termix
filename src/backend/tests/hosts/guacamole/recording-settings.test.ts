import { describe, expect, it } from "vitest";
import { withRecordingSettings } from "../../../hosts/guacamole/recording-settings.js";

const PATH = "/app/data/session_recordings/guacamole";
const NAME = "b7e6c0f2-0000-4000-8000-000000000000.guac";

describe("withRecordingSettings", () => {
  it("takes ownership of the location and filename", () => {
    const merged = withRecordingSettings(
      {
        "recording-path": "/var/lib/termix/recordings",
        "recording-name": "${GUAC_USERNAME}-${GUAC_DATE}",
        "create-recording-path": false,
      },
      PATH,
      NAME,
    );

    expect(merged).toMatchObject({
      "recording-path": PATH,
      "recording-name": NAME,
      "create-recording-path": true,
    });
  });

  it("defaults the content flags when the host has no opinion", () => {
    expect(withRecordingSettings({}, PATH, NAME)).toMatchObject({
      "recording-exclude-output": false,
      "recording-include-keys": true,
    });
  });

  it("keeps the host's content flags, including the falsy ones", () => {
    const merged = withRecordingSettings(
      {
        "recording-exclude-output": true,
        "recording-include-keys": false,
      },
      PATH,
      NAME,
    );

    expect(merged).toMatchObject({
      "recording-exclude-output": true,
      "recording-include-keys": false,
    });
  });

  it("leaves unrelated settings alone", () => {
    const merged = withRecordingSettings(
      { "recording-exclude-mouse": true, width: "1920" },
      PATH,
      NAME,
    );

    expect(merged).toMatchObject({
      "recording-exclude-mouse": true,
      width: "1920",
    });
  });

  it("does not mutate the settings it was given", () => {
    const original = { "recording-path": "/tmp/mine" };
    withRecordingSettings(original, PATH, NAME);

    expect(original).toEqual({ "recording-path": "/tmp/mine" });
  });
});
