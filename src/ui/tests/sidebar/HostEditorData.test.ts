import { describe, it, expect } from "vitest";
import { registerHostProtocol } from "../../sidebar/host-protocols";
import {
  applyHostDraft,
  createHostEditorForm,
  buildHostEditorPayload,
  omitOwnerSshAuthFromSharedEdit,
  connectionOriginAppliesTo,
  type HostProtocols,
} from "../../sidebar/HostEditorData";
import type { Host } from "@/types/ui-types";
import { HOST_PROTOCOL_SECRET_KEPT } from "@termix/plugin-sdk/frontend";

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
    expect(sharedEdit.sshOptions?.agentSocketPath).toBeUndefined();
    for (const field of [
      "authType",
      "credentialId",
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
    const tc = payload.sshOptions as unknown as Record<string, unknown> | null;

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
    const tc = payload.sshOptions as unknown as Record<string, unknown> | null;

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
    const tc = payload.sshOptions as unknown as Record<string, unknown> | null;

    expect(tc?.agentSocketPath).toBeNull();
  });

  it("preserves agentIdentity in sshOptions when authType is agent", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentIdentity: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload.sshOptions as unknown as Record<string, unknown> | null;

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
    const tc = payload.sshOptions as unknown as Record<string, unknown> | null;

    expect(tc?.agentIdentity).toBeNull();
  });

  it("keeps agentIdentity in sshOptions for shared edits (not owner-private)", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "agent" as const,
      agentIdentity: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const sharedEdit = omitOwnerSshAuthFromSharedEdit(payload);

    expect(sharedEdit.sshOptions?.agentIdentity).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key",
    );
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
    const tc = payload as unknown as Record<string, unknown>;

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
    const tc = payload as unknown as Record<string, unknown>;

    expect(tc?.sudoPassword).toBe("new-sudo-pass");
  });

  it("sends an empty value to explicitly clear a saved sudo password", () => {
    const host = { hasSudoPassword: true } as Host;
    const form = {
      ...createHostEditorForm(host),
      sudoPassword: "",
    };

    const payload = buildHostEditorPayload(form, sshOnly);
    const tc = payload as unknown as Record<string, unknown>;

    expect(tc?.sudoPassword).toBe("");
  });
});

describe("plugin host settings", () => {
  it("keeps them on the form and out of the host payload", () => {
    const host = {
      pluginSettings: { proxmox: { enableProxmox: true } },
    } as unknown as Host;

    const form = createHostEditorForm(host);
    const payload = buildHostEditorPayload(form, sshOnly);

    expect(form.pluginSettings).toEqual({ proxmox: { enableProxmox: true } });
    expect(payload).not.toHaveProperty("enableProxmox");
    expect(payload).not.toHaveProperty("pluginSettings");
  });
});

describe("plugin protocol logins", () => {
  const spice = {
    id: "spice",
    pluginId: "spice-plugin",
    settingKey: "enableSpice",
    defaultPort: 5930,
    titleKey: "spice",
    icon: () => null,
  };
  const spiceOn: HostProtocols = { enableSsh: false, enableSpice: true };
  const spiceOff: HostProtocols = { enableSsh: true, enableSpice: false };
  const saved = {
    protocolAuth: {
      spice: {
        authType: "direct",
        credentialId: null,
        username: "viewer",
        fields: { display: "0" },
        hasPassword: true,
        secretFieldKeys: ["ticket"],
      },
    },
  } as unknown as Host;

  it("holds a saved password and secret fields behind the placeholder", () => {
    const form = createHostEditorForm(saved);

    expect(form.protocolAuth.spice).toEqual({
      authType: "direct",
      credentialId: "",
      username: "viewer",
      password: HOST_PROTOCOL_SECRET_KEPT,
      fields: { display: "0", ticket: HOST_PROTOCOL_SECRET_KEPT },
    });
  });

  it("leaves unchanged secrets out of the payload", () => {
    const dispose = registerHostProtocol(spice);
    try {
      const payload = buildHostEditorPayload(
        createHostEditorForm(saved),
        spiceOn,
      );
      expect(payload.protocolAuth?.spice).toEqual({
        authType: "direct",
        credentialId: null,
        username: "viewer",
        fields: { display: "0" },
      });
    } finally {
      dispose();
    }
  });

  it("sends a newly typed password", () => {
    const dispose = registerHostProtocol(spice);
    try {
      const form = createHostEditorForm(saved);
      form.protocolAuth.spice.password = "new-pass";
      const payload = buildHostEditorPayload(form, spiceOn);
      expect(payload.protocolAuth?.spice?.password).toBe("new-pass");
    } finally {
      dispose();
    }
  });

  it("sends only the credential for a credential login", () => {
    const dispose = registerHostProtocol(spice);
    try {
      const form = createHostEditorForm(saved);
      form.protocolAuth.spice = {
        ...form.protocolAuth.spice,
        authType: "credential",
        credentialId: "7",
      };
      const login = buildHostEditorPayload(form, spiceOn).protocolAuth?.spice;
      expect(login).toMatchObject({
        authType: "credential",
        credentialId: 7,
        username: null,
      });
      expect(login).not.toHaveProperty("password");
    } finally {
      dispose();
    }
  });

  it("removes the login of a protocol switched off", () => {
    const dispose = registerHostProtocol(spice);
    try {
      const payload = buildHostEditorPayload(
        createHostEditorForm(saved),
        spiceOff,
      );
      expect(payload.protocolAuth).toEqual({ spice: null });
    } finally {
      dispose();
    }
  });

  it("leaves a protocol no running plugin registered alone", () => {
    const payload = buildHostEditorPayload(
      createHostEditorForm(saved),
      spiceOn,
    );
    expect(payload.protocolAuth).toEqual({});
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

// Support#1240: RDP/VNC/Telnet can now originate from the desktop, so the
// control has to appear for hosts that enable only those protocols -- it used
// to be gated on SSH alone.
describe("connectionOriginAppliesTo", () => {
  const none = {
    enableSsh: false,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
  };

  it("applies to an SSH host", () => {
    expect(connectionOriginAppliesTo({ ...none, enableSsh: true })).toBe(true);
  });

  it.each(["enableRdp", "enableVnc", "enableTelnet"] as const)(
    "applies to a host that only enables %s",
    (protocol) => {
      expect(connectionOriginAppliesTo({ ...none, [protocol]: true })).toBe(
        true,
      );
    },
  );

  it("does not apply when no supported protocol is enabled", () => {
    expect(connectionOriginAppliesTo(none)).toBe(false);
  });
});

describe("terminal fields", () => {
  it("sends no terminalConfig, and the SSH options on their own", () => {
    const form = {
      ...createHostEditorForm(null),
      keepaliveInterval: 30,
      agentForwarding: true,
      environmentVariables: [{ key: "LANG", value: "C" }],
    };
    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload).not.toHaveProperty("terminalConfig");
    expect(payload.sshOptions).toMatchObject({
      keepaliveInterval: 30,
      keepaliveCountMax: 5,
      allowLegacyAlgorithms: true,
      agentForwarding: true,
      environmentVariables: [{ key: "LANG", value: "C" }],
    });
  });

  it("reads a host's SSH options back into the form", () => {
    const host = {
      sshOptions: { keepaliveInterval: 15, allowLegacyAlgorithms: false },
      terminalConfig: { startupSnippetId: 2 },
    } as unknown as Host;
    const form = createHostEditorForm(host);

    expect(form.keepaliveInterval).toBe(15);
    expect(form.allowLegacyAlgorithms).toBe(false);
    expect(form).not.toHaveProperty("startupSnippetId");
  });

  it("leaves the terminal fields out with SSH off", () => {
    const payload = buildHostEditorPayload(createHostEditorForm(null), rdpOnly);
    expect(payload).not.toHaveProperty("terminalConfig");
    expect(payload).not.toHaveProperty("sshOptions");
    expect(payload).not.toHaveProperty("sudoPassword");
  });
});

describe("plugin protocols", () => {
  it("uses the first protocol switched on as the host's type and port without SSH", () => {
    const dispose = registerHostProtocol({
      id: "demo-desktop",
      pluginId: "demo",
      settingKey: "enableDemo",
      portKey: "demoPort",
      defaultPort: 3389,
      titleKey: "demo",
      icon: () => null,
    });
    const form = {
      ...createHostEditorForm(null),
      pluginSettings: { demo: { demoPort: 3390 } },
    };
    const payload = buildHostEditorPayload(form, {
      enableSsh: false,
      enableDemo: true,
    });
    dispose();
    expect(payload.connectionType).toBe("demo-desktop");
    expect(payload.port).toBe(3390);
    expect(payload.enableSsh).toBe(false);
  });
});

describe("applyHostDraft", () => {
  it("fills a new host's form from a plugin draft", () => {
    const form = applyHostDraft(createHostEditorForm(null), {
      name: "box",
      ip: "100.64.0.1",
      port: 2222,
      username: "luke",
      authType: "tailscale",
    });
    expect(form).toMatchObject({
      name: "box",
      ip: "100.64.0.1",
      sshPort: 2222,
      username: "luke",
      authType: "tailscale",
    });
  });

  it("leaves the form alone without a draft", () => {
    const form = createHostEditorForm(null);
    expect(applyHostDraft(form, undefined)).toBe(form);
  });
});
