import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQuickConnectHost,
  isQuickConnectHost,
  quickConnectGuacHost,
  quickConnectHostToPayload,
} from "../../sidebar/quick-connect-host";

describe("quick connect host", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves password authentication when saving the connection", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const host = createQuickConnectHost({
      ip: "server.example.com",
      port: 2222,
      username: "root",
      authType: "password",
      password: "secret",
    });

    expect(host.id).toBe("quick-connect-1234");
    expect(quickConnectHostToPayload(host)).toMatchObject({
      name: "root@server.example.com",
      ip: "server.example.com",
      port: 2222,
      username: "root",
      authType: "password",
      password: "secret",
      connectionType: "ssh",
    });
  });

  it("keeps only the selected credential authentication data", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.2",
      port: 22,
      username: "deploy",
      authType: "credential",
      credentialId: "42",
      password: "ignored",
      key: "ignored",
    });
    const payload = quickConnectHostToPayload(host);

    expect(payload.credentialId).toBe(42);
    expect(payload.password).toBeUndefined();
    expect(payload.key).toBeUndefined();
  });
});

describe("createQuickConnectHost for remote desktop protocols", () => {
  it("builds an SSH host by default", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.1",
      port: 2222,
      username: "root",
      authType: "password",
      password: "pw",
    });
    expect(isQuickConnectHost(host)).toBe(true);
    expect(host).toMatchObject({
      enableSsh: true,
      enableRdp: false,
      sshPort: 2222,
      password: "pw",
    });
  });

  it("builds an RDP host that GuacamoleApp can mint a token from", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.2",
      port: 3390,
      username: "admin",
      authType: "password",
      password: "pw",
      protocol: "rdp",
      domain: "CORP",
    });
    expect(host).toMatchObject({
      enableSsh: false,
      enableRdp: true,
      enableVnc: false,
      rdpPort: 3390,
      rdpUser: "admin",
      rdpPassword: "pw",
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

  it("builds a VNC host with the password on the VNC fields", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.3",
      port: 5901,
      username: "",
      authType: "password",
      password: "vncpw",
      protocol: "vnc",
    });
    expect(host).toMatchObject({
      enableVnc: true,
      vncPort: 5901,
      vncPassword: "vncpw",
    });
    expect(quickConnectGuacHost(host)).toMatchObject({
      connectionType: "vnc",
      vncPort: 5901,
      vncPassword: "vncpw",
    });
  });
});
