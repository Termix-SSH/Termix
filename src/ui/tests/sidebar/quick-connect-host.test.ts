import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQuickConnectHost,
  isQuickConnectHost,
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
      sshPort: 2222,
      password: "pw",
    });
  });

  const desktop = {
    id: "demo-desktop",
    pluginId: "demo",
    settingKey: "enableDemo",
    portKey: "demoPort",
    defaultPort: 3389,
    titleKey: "demo",
    icon: () => null,
  };

  it("builds a plugin protocol host with its switch and port in plugin settings", () => {
    const host = createQuickConnectHost({
      ip: "10.0.0.2",
      port: 3390,
      username: "admin",
      authType: "password",
      password: "pw",
      protocol: desktop,
      domain: "CORP",
    });
    expect(host).toMatchObject({
      enableSsh: false,
      pluginSettings: { demo: { enableDemo: true, demoPort: 3390 } },
      domain: "CORP",
    });
    // The login sits on the core fields named after the protocol.
    expect(host).toMatchObject({
      "demo-desktopUser": "admin",
      "demo-desktopPassword": "pw",
    });
  });

  it("carries the fields a plugin's SSH auth editor filled in", () => {
    const host = createQuickConnectHost({
      ip: "100.64.0.9",
      port: 22,
      username: "root",
      authType: "tailnet-login",
      authFields: { pluginSettings: { demo: { profileId: 3 } } },
    });
    expect(host.authType).toBe("tailnet-login");
    expect(host.password).toBeUndefined();
    expect(host).toMatchObject({
      pluginSettings: { demo: { profileId: 3 } },
    });
  });

  it("marks only hosts core can save", () => {
    const base = { ip: "10.0.0.2", port: 22, username: "root" };
    expect(
      createQuickConnectHost({ ...base, authType: "password" })
        .quickConnectSavable,
    ).toBe(true);
    expect(
      createQuickConnectHost({ ...base, authType: "tailscale" })
        .quickConnectSavable,
    ).toBe(false);
    expect(
      createQuickConnectHost({
        ...base,
        authType: "password",
        authFields: { extra: true },
      }).quickConnectSavable,
    ).toBe(false);
  });
});
