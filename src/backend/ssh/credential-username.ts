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
 * Expands the `$oidc.preferred_username` placeholder in an SSH username to the
 * connecting user's OIDC identifier. Returns the username unchanged if it does
 * not contain the placeholder or the user has no OIDC identifier.
 */
export async function expandOidcUsername(
  username: string | undefined,
  userId: string,
): Promise<string | undefined> {
  if (!username || !username.includes("$oidc.preferred_username")) {
    return username;
  }

  try {
    const { getDb } = await import("../database/db/index.js");
    const { users } = await import("../database/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const db = getDb();
    const rows = await db
      .select({ oidcIdentifier: users.oidcIdentifier })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const oidcIdentifier = rows[0]?.oidcIdentifier;
    if (!oidcIdentifier) return username;

    return username.replace(/\$oidc\.preferred_username/g, oidcIdentifier);
  } catch {
    return username;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
