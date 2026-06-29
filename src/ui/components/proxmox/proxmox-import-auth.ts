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
  if (defaultAuthType === "credential" || (!defaultAuthType && credentialId)) {
    return credentialId
      ? {
          authType: "credential",
          credentialId,
          overrideCredentialUsername: true,
        }
      : { authType: "none" };
  }

  if (defaultAuthType && SECRETLESS_AUTH_TYPES.has(defaultAuthType)) {
    return { authType: defaultAuthType };
  }

  if (defaultAuthType && !SECRET_BACKED_AUTH_TYPES.has(defaultAuthType)) {
    return { authType: defaultAuthType };
  }

  return { authType: "none" };
}
