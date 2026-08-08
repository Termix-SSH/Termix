// Pure decision: which auth settings an imported Proxmox guest inherits.
//
// The frontend carries a parallel copy in
// src/ui/components/proxmox/proxmox-import-auth.ts. The two drifting apart is
// what produced the reported import bug, so both are kept behaviourally
// identical and each is unit-tested against the same matrix.
export function resolveProxmoxImportAuth(
  defaultAuthType: string | undefined,
  credentialId: number | null | undefined,
): {
  authType: string;
  credentialId: number | null;
  overrideCredentialUsername: number;
} {
  // An explicit special auth type (none/opkssh/tailscale/vault/…) wins.
  if (
    defaultAuthType &&
    defaultAuthType !== "credential" &&
    !["password", "key"].includes(defaultAuthType)
  ) {
    return {
      authType: defaultAuthType,
      credentialId: null,
      overrideCredentialUsername: 0,
    };
  }

  // A credential (configured default OR inherited from the source host) is a
  // concrete auth source -> use it, even when defaultAuthType is the
  // "password"/"key" default.
  if (credentialId) {
    return {
      authType: "credential",
      credentialId,
      overrideCredentialUsername: 1,
    };
  }

  return {
    authType: "none",
    credentialId: null,
    overrideCredentialUsername: 0,
  };
}
