/**
 * Frontend copy of the permission matching rules.
 *
 * This mirrors PermissionManager.hasPermission in
 * src/backend/utils/permission-manager.ts and has to stay in step with it. It
 * is a second implementation of one rule, which is a real cost, accepted here
 * only because this copy is cosmetic: it decides what UI to show, never what
 * a request is allowed to do. The server checks again on every route.
 */

/**
 * Whether a granted permission set covers the one required.
 *
 * Order matches the backend: the "*" superuser grant, an exact match, then
 * progressively shorter dotted wildcards, then admin last.
 */
export function matchesPermission(
  granted: readonly string[],
  isAdmin: boolean,
  required: string,
): boolean {
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;

  const parts = required.split(".");
  for (let i = parts.length; i > 0; i--) {
    if (granted.includes(parts.slice(0, i).join(".") + ".*")) return true;
  }

  return isAdmin;
}
