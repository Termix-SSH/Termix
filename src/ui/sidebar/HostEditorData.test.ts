import { describe, it, expect } from "vitest";
import {
  createHostEditorForm,
  buildHostEditorPayload,
  type HostProtocols,
} from "./HostEditorData";

const sshOnly: HostProtocols = {
  enableSsh: true,
  enableRdp: false,
  enableVnc: false,
  enableTelnet: false,
};

describe("buildHostEditorPayload auth field isolation", () => {
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

  it("only sends the credentialId when authType is credential", () => {
    const form = {
      ...createHostEditorForm(null),
      authType: "credential" as const,
      credentialId: "7",
      password: "leftover",
      key: "leftover-key",
    };

    const payload = buildHostEditorPayload(form, sshOnly);

    expect(payload.credentialId).toBe(7);
    expect(payload.password).toBeNull();
    expect(payload.key).toBeNull();
  });

  it("only sends key fields when authType is key", () => {
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
    expect(payload.password).toBeNull();
    expect(payload.credentialId).toBeNull();
  });
});
