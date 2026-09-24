import type { PluginSettingsField } from "@/api/plugins-api";

/**
 * Whether the generic form draws a field: not hidden (the plugin edits it in
 * its own UI) and its `requires` gate satisfied.
 *
 * Kept out of the component file so both the settings page and the host editor
 * section can import it without dragging a component along.
 */
export function isFieldActive(
  field: PluginSettingsField,
  values: Record<string, unknown>,
): boolean {
  if (field.hidden) return false;
  if (!field.requires) return true;
  return values[field.requires] === true;
}

/** Whether a plugin has any field the generic form would ever draw. */
export function hasVisibleFields(fields: PluginSettingsField[]): boolean {
  return fields.some((field) => !field.hidden);
}
