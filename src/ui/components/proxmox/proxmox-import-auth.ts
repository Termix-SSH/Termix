// Auth types that need a secret the discovered guest does not carry. A
// configured default credential supplies exactly that, so these resolve to
// credential auth when one is set and fall back to "none" when it is not.
// Everything else needs no secret and is imported as configured.
const SECRET_BACKED_AUTH_TYPES = new Set(["password", "key", "credential"]);

export type ProxmoxImportAuth = {
  authType: string;
  credentialId?: number;
  overrideCredentialUsername?: boolean;
};

export function resolveProxmoxImportAuth(
  defaultAuthType: string | undefined,
  credentialId: number | null | undefined,
): ProxmoxImportAuth {
  if (!defaultAuthType || SECRET_BACKED_AUTH_TYPES.has(defaultAuthType)) {
    return credentialId
      ? {
          authType: "credential",
          credentialId,
          overrideCredentialUsername: true,
        }
      : { authType: "none" };
  }

  return { authType: defaultAuthType };
}
