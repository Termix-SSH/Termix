/** Core's own protocol. Every other one is declared by a plugin. */
export const SSH_AUTH_PROTOCOL = "ssh";

/** "ssh", or a protocol id a plugin declares in contributes.protocols. */
export type AuthOverrideProtocol = string;

export interface HostAuthOverrideState<
  CredentialId extends number | string = number,
> {
  credentialId?: CredentialId;
  required: boolean;
  ownerAuthShared: boolean;
}

export type HostAuthOverrides<CredentialId extends number | string = number> =
  Partial<Record<AuthOverrideProtocol, HostAuthOverrideState<CredentialId>>>;
