import { describe, expect, it } from "vitest";
import { resolveProxmoxImportAuth } from "../../../components/proxmox/proxmox-import-auth";

describe("resolveProxmoxImportAuth", () => {
  it("inherits an available credential even with the default 'password' authType", () => {
    // Regression guard: a Proxmox host authenticating via a Termix credential
    // used to yield authType 'none' for imported guests because the default
    // authType is 'password', not 'credential'.
    expect(resolveProxmoxImportAuth("password", 42)).toEqual({
      authType: "credential",
      credentialId: 42,
      overrideCredentialUsername: true,
    });
  });

  it("uses the credential when authType is explicitly 'credential'", () => {
    expect(resolveProxmoxImportAuth("credential", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: true,
    });
  });

  it("uses the credential when no authType is given", () => {
    expect(resolveProxmoxImportAuth(undefined, 5)).toEqual({
      authType: "credential",
      credentialId: 5,
      overrideCredentialUsername: true,
    });
  });

  it("lets an explicit secretless authType win over an available credential", () => {
    expect(resolveProxmoxImportAuth("none", 42)).toEqual({ authType: "none" });
    expect(resolveProxmoxImportAuth("tailscale", 42)).toEqual({
      authType: "tailscale",
    });
    expect(resolveProxmoxImportAuth("agent", 42)).toEqual({
      authType: "agent",
    });
  });

  it("falls back to 'none' when no credential is available", () => {
    expect(resolveProxmoxImportAuth("password", null)).toEqual({
      authType: "none",
    });
    expect(resolveProxmoxImportAuth("key", undefined)).toEqual({
      authType: "none",
    });
    expect(resolveProxmoxImportAuth(undefined, undefined)).toEqual({
      authType: "none",
    });
  });

  it("passes through a non secret-backed special type without a credential", () => {
    expect(resolveProxmoxImportAuth("opkssh", null)).toEqual({
      authType: "opkssh",
    });
  });
});
