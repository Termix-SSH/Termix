/**
 * Whether a user signs in through an external login (SSO, LDAP or any login
 * plugin) rather than only a password: they have a user_external_identities
 * row. UserRepository fills isExternal.
 */
export function isExternalAccount(user: {
  isExternal?: boolean | null;
}): boolean {
  return !!user.isExternal;
}
