import { describe, expect, it } from "vitest";
import {
  readCoreDefault,
  writeCoreDefault,
} from "../../../hosts/defaults/core-columns.js";

describe("core defaults in column form", () => {
  it("reads the SSH options a row keeps as JSON", () => {
    const row = {
      sshOptions: JSON.stringify({ keepaliveInterval: 30 }),
    };
    expect(readCoreDefault("keepaliveInterval", row)).toBe(30);
    expect(readCoreDefault("keepaliveCountMax", row)).toBe(5);
    expect(readCoreDefault("allowLegacyAlgorithms", row)).toBe(true);
  });

  it("writes one SSH option and keeps the others", () => {
    const row = {
      sshOptions: JSON.stringify({
        keepaliveInterval: 30,
        agentForwarding: true,
      }),
    };
    const patch = writeCoreDefault("keepaliveInterval", 90, row);
    expect(JSON.parse(patch.sshOptions as string)).toEqual({
      keepaliveInterval: 90,
      agentForwarding: true,
    });
  });

  it("moves an SSH host's port with its SSH port, but not a plugin protocol's", () => {
    expect(
      writeCoreDefault("sshPort", 2222, { connectionType: "ssh" }),
    ).toEqual({ sshPort: 2222, port: 2222 });
    expect(
      writeCoreDefault("sshPort", 2222, { connectionType: "rdp" }),
    ).toEqual({ sshPort: 2222 });
  });

  it("writes a credential login and clears any key the host held", () => {
    const patch = writeCoreDefault(
      "auth",
      { authType: "credential", credentialId: 7 },
      { sshOptions: null, password: "kept" },
    );
    expect(patch).toMatchObject({
      authType: "credential",
      credentialId: 7,
      key: null,
      keyPassword: null,
    });
    expect(patch).not.toHaveProperty("password");
    expect(
      writeCoreDefault("auth", { authType: "agent" }, {}).password,
    ).toBeNull();
  });

  it("round-trips a proxy and keeps the host's own chain passwords", () => {
    const row = {
      socks5ProxyChain: JSON.stringify([{ host: "a", password: "mine" }]),
    };
    const patch = writeCoreDefault(
      "socks5",
      { useSocks5: true, socks5ProxyChain: [{ host: "a" }] },
      row,
    );
    expect(JSON.parse(patch.socks5ProxyChain as string)).toEqual([
      { host: "a", password: "mine" },
    ]);
    expect(readCoreDefault("socks5", { ...row, ...patch })).toMatchObject({
      useSocks5: true,
      socks5ProxyChain: [{ host: "a" }],
    });
  });

  it("stores empty lists as null and booleans as the column expects", () => {
    expect(writeCoreDefault("jumpHosts", [], {})).toEqual({ jumpHosts: null });
    expect(writeCoreDefault("forceKeyboardInteractive", true, {})).toEqual({
      forceKeyboardInteractive: "true",
    });
    expect(
      readCoreDefault("forceKeyboardInteractive", {
        forceKeyboardInteractive: "false",
      }),
    ).toBe(false);
  });
});
