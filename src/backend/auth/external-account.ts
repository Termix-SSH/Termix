/**
 * Whether a user signs in through an external login (SSO, LDAP or any login
 * plugin) rather than only a password. Read from the is_oidc column, which
 * keeps its 2.8 name until 3.0.0 replaces it with user_external_identities.
 */
export function isExternalAccount(user: {
  isOidc?: boolean | number | null;
}): boolean {
  return !!user.isOidc;
}
