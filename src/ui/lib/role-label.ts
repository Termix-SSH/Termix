import type { Translator } from "./plugin-i18n";

/** System roles store an i18n key as their display name. */
export function roleLabel<T extends string | null | undefined>(
  t: Translator,
  displayName: T,
): T | string {
  return typeof displayName === "string" &&
    displayName.startsWith("rbac.roles.")
    ? t(displayName)
    : displayName;
}
