import { describe, expect, it } from "vitest";
import { guestPluginSettings } from "../../src/backend/routes.js";

describe("guestPluginSettings", () => {
  it("names the plugin that keeps each switch an imported guest needs", () => {
    expect(guestPluginSettings("rdp", true)).toEqual({
      "remote-desktop": { enableRdp: true, rdpPort: 3389 },
      docker: { enableDocker: true },
    });
    expect(guestPluginSettings("ssh", false)).toEqual({});
  });
});
