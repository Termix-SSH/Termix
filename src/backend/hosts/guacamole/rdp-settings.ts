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
