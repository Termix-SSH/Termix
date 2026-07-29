import { describe, expect, it } from "vitest";
import { resolveProxmoxImportAuth } from "../../../components/proxmox/proxmox-import-auth";

describe("resolveProxmoxImportAuth", () => {
  it("uses credential auth when a credential is available", () => {
    expect(resolveProxmoxImportAuth(undefined, 42)).toEqual({
      authType: "credential",
      credentialId: 42,
      overrideCredentialUsername: true,
    });
  });

  it("does not import password auth without a password secret", () => {
    expect(resolveProxmoxImportAuth("password", null)).toEqual({
      authType: "none",
    });
  });

  it("does not import key auth without a private key secret", () => {
    expect(resolveProxmoxImportAuth("key", undefined)).toEqual({
      authType: "none",
    });
  });

  // The reported bug: "SSH Key" plus a default credential produced hosts with
  // auth type "none", because password/key fell past every branch. The
  // credential holds the key the guest itself cannot carry, so it should be
  // used rather than discarded.
  it("uses the default credential for key auth when one is configured", () => {
    expect(resolveProxmoxImportAuth("key", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: true,
    });
  });

  it("uses the default credential for password auth when one is configured", () => {
    expect(resolveProxmoxImportAuth("password", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: true,
    });
  });

  it("still resolves an explicit credential default through the credential", () => {
    expect(resolveProxmoxImportAuth("credential", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: true,
    });
    expect(resolveProxmoxImportAuth("credential", null)).toEqual({
      authType: "none",
    });
  });

  it("keeps secretless auth types, with or without a credential", () => {
    for (const authType of ["none", "opkssh", "tailscale", "vault"]) {
      expect(resolveProxmoxImportAuth(authType, null)).toEqual({ authType });
      expect(resolveProxmoxImportAuth(authType, 7)).toEqual({ authType });
    }
  });

  it("passes through an auth type it does not know about", () => {
    expect(resolveProxmoxImportAuth("agent", null)).toEqual({
      authType: "agent",
    });
  });
});
