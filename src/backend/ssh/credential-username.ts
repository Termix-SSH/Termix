/**
 * Decides which username to use when a host is backed by a saved credential.
 *
 * An explicitly-set host username always wins - if the user typed a username on
 * the host it should be honoured even when a credential is attached. The
 * credential's username is only used as a fallback when the host has none. The
 * `overrideCredentialUsername` flag forces the host username regardless.
 */
export function pickResolvedUsername(
  hostUsername: unknown,
  credentialUsername: unknown,
  overrideCredentialUsername?: unknown,
): string | undefined {
  const host = isNonEmptyString(hostUsername) ? hostUsername : undefined;
  const cred = isNonEmptyString(credentialUsername)
    ? credentialUsername
    : undefined;

  if (overrideCredentialUsername) return host;
  if (host) return host;
  return cred;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
