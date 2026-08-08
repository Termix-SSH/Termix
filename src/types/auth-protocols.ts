export const AUTH_OVERRIDE_PROTOCOLS = ["ssh", "rdp", "vnc", "telnet"] as const;

export type AuthOverrideProtocol = (typeof AUTH_OVERRIDE_PROTOCOLS)[number];

// Storage and API contracts are protocol-aware, but SSH is intentionally the
// only protocol whose recipient override flow is enabled today.
export const SUPPORTED_AUTH_OVERRIDE_PROTOCOLS = [
  "ssh",
] as const satisfies readonly AuthOverrideProtocol[];

export const AUTH_PROTOCOL_METADATA = {
  ssh: {
    label: "SSH",
    enableField: "enableSsh",
    credentialField: "credentialId",
  },
  rdp: {
    label: "RDP",
    enableField: "enableRdp",
    credentialField: "rdpCredentialId",
  },
  vnc: {
    label: "VNC",
    enableField: "enableVnc",
    credentialField: "vncCredentialId",
  },
  telnet: {
    label: "Telnet",
    enableField: "enableTelnet",
    credentialField: "telnetCredentialId",
  },
} as const satisfies Record<
  AuthOverrideProtocol,
  {
    label: string;
    enableField: "enableSsh" | "enableRdp" | "enableVnc" | "enableTelnet";
    credentialField:
      | "credentialId"
      | "rdpCredentialId"
      | "vncCredentialId"
      | "telnetCredentialId";
  }
>;

export function isAuthOverrideProtocol(
  value: unknown,
): value is AuthOverrideProtocol {
  return (
    typeof value === "string" &&
    AUTH_OVERRIDE_PROTOCOLS.includes(value as AuthOverrideProtocol)
  );
}

export function isSupportedAuthOverrideProtocol(
  protocol: AuthOverrideProtocol,
): boolean {
  return SUPPORTED_AUTH_OVERRIDE_PROTOCOLS.includes(
    protocol as (typeof SUPPORTED_AUTH_OVERRIDE_PROTOCOLS)[number],
  );
}

export interface HostAuthOverrideState<
  CredentialId extends number | string = number,
> {
  credentialId?: CredentialId;
  required: boolean;
  ownerAuthShared: boolean;
}

export type HostAuthOverrides<CredentialId extends number | string = number> =
  Partial<Record<AuthOverrideProtocol, HostAuthOverrideState<CredentialId>>>;
