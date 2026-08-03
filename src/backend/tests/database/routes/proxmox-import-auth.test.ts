import { describe, expect, it } from "vitest";
import { resolveProxmoxImportAuth } from "../../../database/routes/proxmox-import-auth.js";

// The frontend carries its own copy of this decision in
// src/ui/components/proxmox/proxmox-import-auth.ts. The two drifting apart is
// what produced the reported bug, so both are held to the same matrix.
describe("resolveProxmoxImportAuth", () => {
  it("uses the default credential for key auth when one is configured", () => {
    expect(resolveProxmoxImportAuth("key", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: 1,
    });
  });

  it("uses the default credential for password auth when one is configured", () => {
    expect(resolveProxmoxImportAuth("password", 7)).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: 1,
    });
  });

  it("falls back to none when a secret-backed default has no credential", () => {
    for (const authType of ["password", "key", "credential"]) {
      expect(resolveProxmoxImportAuth(authType, null)).toEqual({
        authType: "none",
        credentialId: null,
        overrideCredentialUsername: 0,
      });
    }
  });

  it("uses the credential when no default auth type is configured", () => {
    expect(resolveProxmoxImportAuth(undefined, 42)).toEqual({
      authType: "credential",
      credentialId: 42,
      overrideCredentialUsername: 1,
    });
    expect(resolveProxmoxImportAuth(undefined, null)).toEqual({
      authType: "none",
      credentialId: null,
      overrideCredentialUsername: 0,
    });
  });

  it("keeps secretless auth types, with or without a credential", () => {
    for (const authType of ["none", "agent", "opkssh", "tailscale", "vault"]) {
      for (const credentialId of [null, 7]) {
        expect(resolveProxmoxImportAuth(authType, credentialId)).toEqual({
          authType,
          credentialId: null,
          overrideCredentialUsername: 0,
        });
      }
    }
  });
});
