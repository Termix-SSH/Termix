import type { Credential } from "@/types/ui-types";
import type { CredentialSortKey } from "@/types/credential-sidebar-preferences";

/**
 * Sorts a flat credential list. No tree recursion needed -- unlike hosts,
 * credential folders are explicitly flat, so this is a plain array sort.
 */
export function sortCredentials(
  creds: Credential[],
  key: CredentialSortKey,
  pinnedFirst = false,
): Credential[] {
  const sorted = [...creds];

  switch (key) {
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "username-asc":
      sorted.sort((a, b) => a.username.localeCompare(b.username));
      break;
    case "username-desc":
      sorted.sort((a, b) => b.username.localeCompare(a.username));
      break;
    case "manual":
      sorted.sort((a, b) => {
        const aOrder = a.sortOrder ?? null;
        const bOrder = b.sortOrder ?? null;
        if (aOrder == null && bOrder == null) return a.name.localeCompare(b.name);
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });
      break;
    case "default":
    default:
      break;
  }

  if (pinnedFirst) {
    sorted.sort((a, b) => {
      const aPinned = a.pin ? 1 : 0;
      const bPinned = b.pin ? 1 : 0;
      return bPinned - aPinned;
    });
  }

  return sorted;
}

export function credentialPassesFilters(
  cred: Credential,
  filters: { type: ("password" | "key")[]; tags: string[] },
): boolean {
  if (filters.type.length > 0 && !filters.type.includes(cred.type))
    return false;
  if (
    filters.tags.length > 0 &&
    !filters.tags.some((tag) => cred.tags?.includes(tag))
  )
    return false;
  return true;
}
