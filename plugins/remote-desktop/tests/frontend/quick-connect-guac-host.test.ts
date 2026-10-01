import { describe, expect, it } from "vitest";
import { quickConnectGuacHost } from "../../src/frontend/quick-connect-guac-host";

// The shape core's Quick Connect builds for a plugin protocol: the switch and
// port in this plugin's host settings, the unsaved login in quickConnectLogin.
function quickHost(protocol: "rdp" | "vnc", extra: Record<string, unknown>) {
  return {
    id: "quick-connect-1",
    name: "admin@10.0.0.2",
    ip: "10.0.0.2",
    pluginSettings: {
      "remote-desktop": {
        [protocol === "rdp" ? "enableRdp" : "enableVnc"]: true,
        [protocol === "rdp" ? "rdpPort" : "vncPort"]:
          protocol === "rdp" ? 3390 : 5901,
      },
    },
    ...extra,
  };
}

describe("quickConnectGuacHost", () => {
  it("carries an RDP quick connect's address and credentials", () => {
    expect(
      quickConnectGuacHost(
        quickHost("rdp", {
          quickConnectLogin: {
            protocol: "rdp",
            username: "admin",
            password: "pw",
            fields: { domain: "CORP" },
          },
        }),
      ),
    ).toMatchObject({
      ip: "10.0.0.2",
      connectionType: "rdp",
      port: 3390,
      username: "admin",
      password: "pw",
      domain: "CORP",
    });
  });

  it("takes a VNC quick connect's login from the VNC fields", () => {
    expect(
      quickConnectGuacHost(
        quickHost("vnc", {
          quickConnectLogin: { protocol: "vnc", password: "vncpw" },
        }),
      ),
    ).toMatchObject({
      connectionType: "vnc",
      port: 5901,
      password: "vncpw",
    });
  });
});
