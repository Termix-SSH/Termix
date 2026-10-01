const SECRET_BACKED_AUTH_TYPES = new Set(["password", "key"]);

export type ProxmoxImportAuth = {
  authType: string;
  credentialId?: number;
  overrideCredentialUsername?: boolean;
};

export function resolveProxmoxImportAuth(
  defaultAuthType: string | undefined,
  credentialId: number | null | undefined,
): ProxmoxImportAuth {
  // Any auth type that needs no stored secret (none, agent, or one a plugin
  // adds) wins, the same rule the backend copy applies.
  if (
    defaultAuthType &&
    defaultAuthType !== "credential" &&
    !SECRET_BACKED_AUTH_TYPES.has(defaultAuthType)
  ) {
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
      overrideCredentialUsername: false,
    };
  }

  return { authType: "none" };
}
