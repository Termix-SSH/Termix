import type { PluginSettingsField } from "@/api/plugins-api";

/**
 * Whether a field's `requires` gate is satisfied.
 *
 * Kept out of the component file so both the settings page and the host editor
 * section can import it without dragging a component along.
 */
export function isFieldActive(
  field: PluginSettingsField,
  values: Record<string, unknown>,
): boolean {
  if (!field.requires) return true;
  return values[field.requires] === true;
}
