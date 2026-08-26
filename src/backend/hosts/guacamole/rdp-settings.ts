interface RdpSettingsInput {
  port: number;
  domain?: string;
  security?: string;
  ignoreCert: boolean;
  guacConfig: Record<string, unknown>;
  guacdOverrides: Record<string, unknown>;
}

export function buildRdpSettings({
  port,
  domain,
  security,
  ignoreCert,
  guacConfig,
  guacdOverrides,
}: RdpSettingsInput): Record<string, unknown> {
  return {
    ...guacConfig,
    port,
    domain,
    ...(security === undefined ? {} : { security }),
    "ignore-cert": ignoreCert,
    ...guacdOverrides,
  };
}

export function resolveRdpDomain(
  authType: string | null,
  promptedDomain: unknown,
  storedDomain: string,
): string {
  return authType === "none" && typeof promptedDomain === "string"
    ? promptedDomain
    : storedDomain;
}

type SharedRdpAuthResolution =
  | { source: "personal-override" }
  | { source: "owner-shared"; authType: string }
  | { source: "secretless" }
  | { source: "required" }
  | null;

export function resolveRdpAuthTypeForConnect({
  storedAuthType,
  credentialId,
  sharedResolution,
}: {
  storedAuthType?: string | null;
  credentialId?: number | null;
  sharedResolution?: SharedRdpAuthResolution;
}): string {
  if (sharedResolution === undefined) {
    return storedAuthType || (credentialId ? "credential" : "direct");
  }
  if (sharedResolution?.source === "personal-override") return "credential";
  if (sharedResolution?.source === "owner-shared") {
    return sharedResolution.authType;
  }
  return sharedResolution?.source === "secretless" && storedAuthType === "none"
    ? "none"
    : "direct";
}
