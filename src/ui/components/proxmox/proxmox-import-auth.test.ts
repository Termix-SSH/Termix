import { describe, expect, it } from "vitest";
import { resolveProxmoxImportAuth } from "./proxmox-import-auth";

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

  it("keeps secretless auth types", () => {
    expect(resolveProxmoxImportAuth("opkssh", null)).toEqual({
      authType: "opkssh",
    });
  });
});
