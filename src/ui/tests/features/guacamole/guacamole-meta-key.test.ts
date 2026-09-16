import { describe, expect, it } from "vitest";
import {
  detectMetaKeyFamily,
  metaKeyLabels,
} from "../../../features/guacamole/guacamole-meta-key.js";

describe("guacamole toolbar meta key labels", () => {
  it("keeps Windows labels for RDP regardless of the local device", () => {
    expect(
      detectMetaKeyFamily("rdp", {
        platform: "MacIntel",
        userAgent: "Macintosh; Intel Mac OS X",
        userAgentDataPlatform: "macOS",
      }),
    ).toBe("win");
  });

  it("labels VNC with the local device's modifier instead of Windows", () => {
    expect(
      detectMetaKeyFamily("vnc", {
        platform: "MacIntel",
        userAgent: "Macintosh; Intel Mac OS X",
        userAgentDataPlatform: "macOS",
      }),
    ).toBe("cmd");
    expect(
      detectMetaKeyFamily("vnc", {
        platform: "Linux x86_64",
        userAgent: "X11; Linux x86_64",
        userAgentDataPlatform: "Linux",
      }),
    ).toBe("super");
    expect(
      detectMetaKeyFamily("vnc", {
        platform: "Win32",
        userAgent: "Windows NT 10.0",
        userAgentDataPlatform: "Windows",
      }),
    ).toBe("win");
  });

  it("exposes Super/Cmd button copy for non-Windows VNC sessions", () => {
    expect(metaKeyLabels("super").short).toBe("Super");
    expect(metaKeyLabels("super").lock).toBe("Super+L");
    expect(metaKeyLabels("cmd").short).toBe("Cmd");
    expect(metaKeyLabels("cmd").lock).toBe("Cmd+L");
  });
});
