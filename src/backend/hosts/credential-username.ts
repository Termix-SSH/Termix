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

/**
 * A host can keep a per-host password while using a shared key credential.
 * Prefer that host-specific value and fall back to the credential password.
 */
export function pickResolvedPassword(
  hostPassword: unknown,
  credentialPassword: unknown,
): string | undefined {
  if (isNonEmptyString(hostPassword)) return hostPassword;
  if (isNonEmptyString(credentialPassword)) return credentialPassword;
  return undefined;
}

const USERNAME_PLACEHOLDER =
  /\$(?:external\.username|oidc\.preferred_username)/g;

/**
 * Expands `$external.username` (or its 2.8 spelling `$oidc.preferred_username`)
 * in an SSH username to the name the connecting user signed in with through
 * SSO or LDAP. Returns the username unchanged if it has no placeholder or the
 * user has no external sign-in.
 */
export async function expandExternalUsername(
  username: string | undefined,
  userId: string,
): Promise<string | undefined> {
  if (!username || !new RegExp(USERNAME_PLACEHOLDER.source).test(username)) {
    return username;
  }

  try {
    const { createCurrentUserRepository } =
      await import("../database/repositories/factory.js");
    const user = await createCurrentUserRepository().findById(userId);
    let externalName = user?.oidcIdentifier;
    if (!externalName) return username;

    const match = /^ldap:(\d+):(.+)$/.exec(externalName);
    if (match) {
      // Only strip the prefix for a real LDAP identity, to prevent spoofing
      // through an SSO subject that happens to look like one.
      const { createCurrentUserAuthRepository } =
        await import("../database/repositories/factory.js");
      const identities =
        await createCurrentUserAuthRepository().listIdentitiesForUser(userId);
      if (
        identities.some(
          (identity) =>
            identity.providerId === `ldap:${match[1]}` &&
            identity.subject === match[2],
        )
      ) {
        externalName = match[2];
      }
    }

    return username.replace(USERNAME_PLACEHOLDER, () => externalName);
  } catch {
    return username;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
