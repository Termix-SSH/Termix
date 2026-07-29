const SECRET_BACKED_AUTH_TYPES = new Set(["password", "key"]);
const SECRETLESS_AUTH_TYPES = new Set(["none", "opkssh", "tailscale", "vault"]);

export type ProxmoxImportAuth = {
  authType: string;
  credentialId?: number;
  overrideCredentialUsername?: boolean;
};

export function resolveProxmoxImportAuth(
  defaultAuthType: string | undefined,
  credentialId: number | null | undefined,
): ProxmoxImportAuth {
  // An explicit secretless auth choice (none/opkssh/tailscale/vault) wins.
  if (defaultAuthType && SECRETLESS_AUTH_TYPES.has(defaultAuthType)) {
    return { authType: defaultAuthType };
  }

  // A credential (configured default OR inherited from the source Proxmox host)
  // is a concrete auth source -> use it, even when defaultAuthType is the
  // "password"/"key" default. Otherwise imported guests end up as authType
  // "none" although the host authenticates via a credential.
  if (credentialId) {
    return {
      authType: "credential",
      credentialId,
      overrideCredentialUsername: true,
    };
  }

  // Explicit non secret-backed special type without a credential.
  if (
    defaultAuthType &&
    defaultAuthType !== "credential" &&
    !SECRET_BACKED_AUTH_TYPES.has(defaultAuthType)
  ) {
    return { authType: defaultAuthType };
  }

  return { authType: "none" };
}
