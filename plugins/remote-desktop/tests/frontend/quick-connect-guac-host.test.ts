import { describe, expect, it } from "vitest";
import { createQuickConnectHost } from "@/sidebar/quick-connect-host";
import { quickConnectGuacHost } from "../../src/frontend/quick-connect-guac-host";

describe("quickConnectGuacHost", () => {
  it("carries an RDP quick connect's address and credentials", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.2",
      port: 3390,
      username: "admin",
      authType: "password",
      password: "pw",
      protocol: "rdp",
      domain: "CORP",
    });
    expect(quickConnectGuacHost(host)).toMatchObject({
      ip: "10.0.0.2",
      connectionType: "rdp",
      rdpPort: 3390,
      rdpUser: "admin",
      rdpPassword: "pw",
      domain: "CORP",
    });
  });

  it("puts a VNC quick connect's password on the VNC fields", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.3",
      port: 5901,
      username: "",
      authType: "password",
      password: "vncpw",
      protocol: "vnc",
    });
    expect(quickConnectGuacHost(host)).toMatchObject({
      connectionType: "vnc",
      vncPort: 5901,
      vncPassword: "vncpw",
    });
  });
});
