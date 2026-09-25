/**
 * Registrations that clashed with another plugin's: a service provider name,
 * a registry key or a permission namespace two plugins both claimed. Each is
 * refused or logged where it happens; this keeps the list so an admin view or
 * a test can see them all.
 */

export interface RegistrationConflict {
  kind: "service" | "registry" | "permission" | "ws";
  pluginId: string;
  /** Who already held it, when known. */
  heldBy?: string;
  name: string;
}

const conflicts: RegistrationConflict[] = [];

export function recordConflict(conflict: RegistrationConflict): void {
  conflicts.push(conflict);
}

export function listRegistrationConflicts(): RegistrationConflict[] {
  return [...conflicts];
}

/** Test seam. */
export function clearRegistrationConflicts(): void {
  conflicts.length = 0;
}
