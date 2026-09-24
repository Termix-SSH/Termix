/**
 * The allowed-users list an external login method passes with its identity:
 * one pattern per line or comma, "*" for anyone, "@example.com" for a
 * domain, "*" as a wildcard inside a pattern, or an exact name. Empty allows
 * everyone.
 */
export function isExternalUserAllowed(
  allowedUsers: string,
  identifier: string,
  email?: string,
): boolean {
  if (!allowedUsers || !allowedUsers.trim()) return true;
  const patterns = allowedUsers
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const values = [
    identifier,
    ...(email && email !== identifier ? [email] : []),
  ];
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      const escaped = pattern
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (values.some((v) => v && regex.test(v.toLowerCase()))) return true;
      continue;
    }
    for (const value of values) {
      if (!value) continue;
      if (pattern.toLowerCase().startsWith("@")) {
        if (value.toLowerCase().endsWith(pattern.toLowerCase())) return true;
      } else {
        if (value.toLowerCase() === pattern.toLowerCase()) return true;
      }
    }
  }
  return false;
}
