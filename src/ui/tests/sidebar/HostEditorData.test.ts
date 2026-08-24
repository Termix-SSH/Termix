import { describe, it, expect } from "vitest";
import {
  createHostEditorForm,
  buildHostEditorPayload,
  omitOwnerSshAuthFromSharedEdit,
  type HostProtocols,
} from "../../sidebar/HostEditorData";
import type { Host } from "@/types/ui-types";

const sshOnly: HostProtocols = {
  enableSsh: true,
  enableRdp: false,
  enableVnc: false,
  enableTelnet: false,
};

const rdpOnly: HostProtocols = {
  enableSsh: false,
  enableRdp: true,
  enableVnc: false,
  enableTelnet: false,
};

const vncOnly: HostProtocols = {
  enableSsh: false,
  enableRdp: false,
  enableVnc: true,
  enableTelnet: false,
};

const telnetOnly: HostProtocols = {
  enableSsh: false,
  enableRdp: false,
  enableVnc: false,
  enableTelnet: true,
};

describe("omitOwnerSshAuthFromSharedEdit", () => {
  it("keeps editable host settings but removes all owner SSH authentication fields", () => {
    const form = createHostEditorForm(null);
    const payload = buildHostEditorPayload(
      {
        ...form,
        ip: "10.0.0.42",
        authType: "agent",
        credentialId: "7",
        password: "owner-password",
        key: "owner-key",
        keyPassword: "owner-passphrase",
        keyType: "ssh-ed25519",
        vaultProfileId: "9",
        overrideCredentialUsername: true,
        shareSshAuth: true,
        sudoPassword: "owner-sudo",
        agentSocketPath: "/run/user/1000/ssh-agent.sock",
        notes: "editable",
      },
      sshOnly,
    );

    const sharedEdit = omitOwnerSshAuthFromSharedEdit(payload);

    expect(sharedEdit.name).toBe(payload.name);
    expect(sharedEdit.ip).toBe("10.0.0.42");
    expect(sharedEdit.notes).toBe("editable");
    expect(sharedEdit.terminalConfig?.sudoPassword).toBeUndefined();
    expect(sharedEdit.terminalConfig?.agentSocketPath).toBeUndefined();
    for (const field of [
      "authType",
      "credentialId",
      "vaultProfileId",
      "overrideCredentialUsername",
      "shareSshAuth",
      "password",
      "key",
      "keyPassword",
      "keyType",
      "sudoPassword",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(sharedEdit, field)).toBe(
        false,
      );
    }
  });
});

describe("buildHostEditorPayload auth field isolation", () => {
  it("persists the owner's SSH authentication sharing choice", () => {
    const form = {
      ...createHostEditorForm(null),
      shareSshAuth: true,
    };

    expect(buildHostEditorPayload(form, sshOnly).shareSshAuth).toBe(true);
  });

  it("only sends the password when authType is password", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "password" as const,
      password: "hunter2",
      key: "PRIVATE KEY",
      keyPassword: "kp",
      credentialId: "5",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.password).toBe("hunter2");
    expect(payload.key).toBeNull();
    expect(payload.keyPassword).toBeNull();
    expect(payload.credentialId).toBeNull();
  });

  it("drops the credentialId when switching a cloned host away from credential auth", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "password" as const,
      password: "newpass",
      credentialId: "12",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.credentialId).toBeNull();
    expect(payload.password).toBe("newpass");
  });

  it("drops the vaultProfileId when switching a host away from vault auth", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "password" as const,
      password: "newpass",
      vaultProfileId: "9",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.vaultProfileId).toBeNull();
    expect(payload.password).toBe("newpass");
  });

  it("sends vaultProfileId when authType is vault", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "vault" as const,
      vaultProfileId: "9",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.vaultProfileId).toBe(9);
  });

  it("sends credentialId and optional password when authType is credential", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "credential" as const,
      credentialId: "7",
      password: "host-specific-password",
      key: "leftover-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.credentialId).toBe(7);
    expect(payload.password).toBe("host-specific-password");
    expect(payload.key).toBeNull();
  });

  it("sends key fields and optional password when authType is key", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "key" as const,
      key: "MY KEY",
      keyType: "ssh-ed25519",
      password: "leftover",
      credentialId: "3",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.key).toBe("MY KEY");
    expect(payload.keyType).toBe("ssh-ed25519");
    expect(payload.password).toBe("leftover");
    expect(payload.credentialId).toBeNull();
  });

  it("preserves agentSocketPath in terminalConfig when authType is agent", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentSocketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.agentSocketPath).toBe("/run/user/1000/gnupg/S.gpg-agent.ssh");
    expect(payload.password).toBeNull();
    expect(payload.key).toBeNull();
  });

  it("sets agentSocketPath to null in payload when authType is agent but path is empty", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentSocketPath: "",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.agentSocketPath).toBeNull();
  });

  it("nulls out agentSocketPath when switching away from agent auth", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "password" as const,
      password: "mypass",
      agentSocketPath: "/run/user/1000/gnupg/S.gpg-agent.ssh",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.agentSocketPath).toBeNull();
  });

  it("preserves agentIdentity in terminalConfig when authType is agent", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentIdentity: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.agentIdentity).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    );
  });

  it("nulls out agentIdentity when switching away from agent auth", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "password" as const,
      password: "mypass",
      agentIdentity: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.agentIdentity).toBeNull();
  });

  it("keeps agentIdentity in terminalConfig for shared edits (not owner-private)", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentIdentity: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const sharedEdit = omitOwnerSshAuthFromSharedEdit(payload);

    expect(sharedEdit.terminalConfig?.agentIdentity).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    );
  });

  it("preserves sudo password autofill settings", () => {
    const form = {
      ...createHostEditorForm(null),
      sudoPasswordAutoFill: true,
      sudoPassword: "sudo-secret",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.sudoPasswordAutoFill).toBe(true);
    expect(tc?.sudoPassword).toBe("sudo-secret");
  });
});

describe("sudo password persistence indicator", () => {
  it("seeds a sentinel value when the host reports a saved sudo password", () => {
    const host = { hasSudoPassword: true } as Host;
    const form = createHostEditorForm(host);

    expect(form.sudoPassword).toBe("existing_sudo_password");
  });

  it("omits sudoPassword from the payload when the sentinel is unchanged, so a save doesn't wipe it", () => {
    const host = { hasSudoPassword: true } as Host;
    const form = { ...createHostEditorForm(host) };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.sudoPassword).toBeUndefined();
    expect(JSON.parse(JSON.stringify(tc))).not.toHaveProperty("sudoPassword");
  });

  it("sends a newly typed sudo password", () => {
    const host = { hasSudoPassword: true } as Host;
    const form = {
      ...createHostEditorForm(host),
      sudoPassword: "new-sudo-pass",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.sudoPassword).toBe("new-sudo-pass");
  });

  it("sends null to explicitly clear a saved sudo password", () => {
    const host = { hasSudoPassword: true } as Host;
    const form = {
      ...createHostEditorForm(host),
      sudoPassword: "",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.terminalConfig as unknown as Record<
      string,
      unknown
    > | null;

    expect(tc?.sudoPassword).toBeNull();
  });
});

describe("Proxmox / Proxmox Stats independent toggles", () => {
  it("defaults enableProxmoxStats to false with sane pollInterval/nodeName defaults", () => {
    const form = createHostEditorForm(null);

    expect(form.enableProxmoxStats).toBe(false);
    expect(form.proxmoxStatsConfig).toEqual({
      pollInterval: 60,
      nodeName: null,
    });
    expect(form.enableProxmox).toBe(false);
  });

  it("seeds both configs independently from an existing host", () => {
    const host = {
      enableProxmox: true,
      proxmoxConfig: { windowsPatterns: "win", dockerPatterns: "docker" },
      enableProxmoxStats: true,
      proxmoxStatsConfig: { pollInterval: 30, nodeName: "pve-custom" },
    } as unknown as Host;

    const form = createHostEditorForm(host);

    expect(form.enableProxmox).toBe(true);
    expect(form.enableProxmoxStats).toBe(true);
    expect(form.proxmoxStatsConfig).toEqual({
      pollInterval: 30,
      nodeName: "pve-custom",
    });
  });

  it("nulls proxmoxStatsConfig in the payload when enableProxmoxStats is off, regardless of enableProxmox", () => {
    const form = {
      ...createHostEditorForm(null),
      enableProxmox: true,
      proxmoxConfig: {
        defaultCredentialId: null,
        defaultAuthType: "password",
        windowsPatterns: "win",
        dockerPatterns: "docker",
        preferredPrefixes: "",
      },
      enableProxmoxStats: false,
      proxmoxStatsConfig: { pollInterval: 45, nodeName: "leftover" },
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.enableProxmox).toBe(true);
    expect(payload.proxmoxConfig).not.toBeNull();
    expect(payload.enableProxmoxStats).toBe(false);
    expect(payload.proxmoxStatsConfig).toBeNull();
  });

  it("keeps proxmoxConfig null in the payload when enableProxmox is off, even though enableProxmoxStats is on", () => {
    const form = {
      ...createHostEditorForm(null),
      enableProxmox: false,
      enableProxmoxStats: true,
      proxmoxStatsConfig: { pollInterval: 90, nodeName: "pve1" },
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.enableProxmox).toBe(false);
    expect(payload.proxmoxConfig).toBeNull();
    expect(payload.enableProxmoxStats).toBe(true);
    expect(payload.proxmoxStatsConfig).toEqual({
      pollInterval: 90,
      nodeName: "pve1",
    });
  });

  it("preserves the source identity when editing an imported Proxmox guest", () => {
    const source = {
      source: "proxmox" as const,
      sourceHostId: 7,
      node: "pve1",
      vmid: 101,
      type: "qemu" as const,
      lastSeenAt: "2026-08-14T00:00:00.000Z",
      lastStatus: "running",
      missingSince: null,
    };
    const form = {
      ...createHostEditorForm({
        enableProxmox: false,
        proxmoxConfig: { source },
      } as unknown as Host),
      name: "Edited guest",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.enableProxmox).toBe(false);
    expect(payload.proxmoxConfig).toEqual({ source });
  });

  it("sends both configs when both toggles are on", () => {
    const form = {
      ...createHostEditorForm(null),
      enableProxmox: true,
      proxmoxConfig: {
        defaultCredentialId: null,
        defaultAuthType: "password",
        windowsPatterns: "win",
        dockerPatterns: "docker",
        preferredPrefixes: "",
      },
      enableProxmoxStats: true,
      proxmoxStatsConfig: { pollInterval: 60, nodeName: null },
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.enableProxmox).toBe(true);
    expect(payload.proxmoxConfig).not.toBeNull();
    expect(payload.enableProxmoxStats).toBe(true);
    expect(payload.proxmoxStatsConfig).toEqual({
      pollInterval: 60,
      nodeName: null,
    });
  });
});

describe("RDP/VNC/Telnet password persistence indicator", () => {
  it("seeds a sentinel value when the host reports a saved rdp password", () => {
    const host = {
      hasRdpPassword: true,
      rdpAuthType: "direct",
    } as Host;

    const form = createHostEditorForm(host);

    expect(form.rdpPassword).toBe("existing_rdp_password");
  });

  it("does not send the rdp sentinel back to the backend unchanged", () => {
    const host = { hasRdpPassword: true, rdpAuthType: "direct" } as Host;
    const form = { ...createHostEditorForm(host) };

    const payload = buildHostEditorPayload(form, rdpOnly);

    expect(payload.rdpPassword).toBeNull();
  });

  it("sends a newly typed rdp password", () => {
    const host = { hasRdpPassword: true, rdpAuthType: "direct" } as Host;
    const form = {
      ...createHostEditorForm(host),
      rdpPassword: "new-rdp-pass",
    };

    const payload = buildHostEditorPayload(form, rdpOnly);

    expect(payload.rdpPassword).toBe("new-rdp-pass");
  });

  it("seeds a sentinel value when the host reports a saved vnc password", () => {
    const host = { hasVncPassword: true, vncAuthType: "direct" } as Host;
    const form = createHostEditorForm(host);

    expect(form.vncPassword).toBe("existing_vnc_password");
  });

  it("does not send the vnc sentinel back to the backend unchanged", () => {
    const host = { hasVncPassword: true, vncAuthType: "direct" } as Host;
    const form = { ...createHostEditorForm(host) };

    const payload = buildHostEditorPayload(form, vncOnly);

    expect(payload.vncPassword).toBeNull();
  });

  it("seeds a sentinel value when the host reports a saved telnet password", () => {
    const host = {
      hasTelnetPassword: true,
      telnetAuthType: "direct",
    } as Host;
    const form = createHostEditorForm(host);

    expect(form.telnetPassword).toBe("existing_telnet_password");
  });

  it("does not send the telnet sentinel back to the backend unchanged", () => {
    const host = {
      hasTelnetPassword: true,
      telnetAuthType: "direct",
    } as Host;
    const form = { ...createHostEditorForm(host) };

    const payload = buildHostEditorPayload(form, telnetOnly);

    expect(payload.telnetPassword).toBeNull();
  });
});

describe("user connection defaults", () => {
  const defaults = {
    terminal: { fontSize: 18, cursorBlink: false },
    rdp: { colorDepth: 24, disableCopy: true },
  };

  it("shows inherited values without persisting them as host overrides", () => {
    const host = {
      enableSsh: true,
      enableRdp: true,
      terminalConfig: { autoTmux: true },
      guacamoleConfig: { enableAudioInput: true },
    } as Host;
    const form = createHostEditorForm(host, undefined, defaults);

    expect(form).toMatchObject({
      fontSize: 18,
      cursorBlink: false,
      inheritTerminalAppearance: true,
      inheritRemoteDesktopDefaults: true,
      guacamoleConfig: {
        colorDepth: 24,
        disableCopy: true,
        enableAudioInput: true,
      },
    });

    const payload = buildHostEditorPayload(form, {
      ...sshOnly,
      enableRdp: true,
    });
    expect(payload.terminalConfig).toMatchObject({ autoTmux: true });
    expect(payload.terminalConfig).not.toHaveProperty("fontSize");
    expect(payload.guacamoleConfig).toEqual({ enableAudioInput: true });
  });

  it("keeps explicit host overrides above user defaults", () => {
    const host = {
      enableSsh: true,
      enableRdp: true,
      terminalConfig: { fontSize: 12 },
      guacamoleConfig: { colorDepth: 32 },
    } as Host;
    const form = createHostEditorForm(host, undefined, defaults);

    expect(form).toMatchObject({
      fontSize: 12,
      inheritTerminalAppearance: false,
      inheritRemoteDesktopDefaults: false,
      guacamoleConfig: { colorDepth: 32, disableCopy: true },
    });
  });
});

describe("createHostEditorForm credentialId", () => {
  it("coerces a numeric credentialId to a string so credential lookups match", () => {
    const form = createHostEditorForm({
      credentialId: 12,
    } as unknown as Host);
    expect(form.credentialId).toBe("12");
  });

  it("keeps a string credentialId as is", () => {
    const form = createHostEditorForm({ credentialId: "12" } as Host);
    expect(form.credentialId).toBe("12");
  });

  it("falls back to an empty string when there is no credential", () => {
    expect(createHostEditorForm(null).credentialId).toBe("");
  });
});

describe("createHostEditorForm auto-tmux", () => {
  it("inherits the admin default for a new host but keeps an existing host's own choice", () => {
    expect(createHostEditorForm(null, { autoTmux: true }).autoTmux).toBe(true);
    expect(createHostEditorForm(null, {}).autoTmux).toBe(false);

    const host = {
      id: "1",
      name: "box",
      terminalConfig: { autoTmux: false },
    } as unknown as Host;
    expect(createHostEditorForm(host, { autoTmux: true }).autoTmux).toBe(false);
  });
});
