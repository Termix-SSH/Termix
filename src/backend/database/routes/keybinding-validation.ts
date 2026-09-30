import {
  CORE_KEYBINDING_ACTIONS,
  validateKeybindingActionParams,
  type PluginKeybindingActionContribution,
} from "@termix/plugin-sdk/manifest";

export interface DeclaredKeybindingAction extends PluginKeybindingActionContribution {
  pluginId: string;
}

let declaredActions: () => DeclaredKeybindingAction[] = () => [];

/** Set by the plugin runtime: every installed plugin's declared actions. */
export function setKeybindingActionSource(
  source: () => DeclaredKeybindingAction[],
): void {
  declaredActions = source;
}

/** The declaration a saved action type answers to, if a plugin made one. */
export function findKeybindingAction(
  type: string,
): DeclaredKeybindingAction | undefined {
  return declaredActions().find((action) => action.id === type);
}

const ACTION_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9.-]{0,63}$/;
const MAX_LOOSE_VALUE = 65_536;

export function isValidKeyCombo(combo: unknown): boolean {
  return (
    !!combo &&
    typeof combo === "object" &&
    typeof (combo as { key?: unknown }).key === "string" &&
    typeof (combo as { isCode?: unknown }).isCode === "boolean" &&
    typeof (combo as { ctrl?: unknown }).ctrl === "boolean" &&
    typeof (combo as { alt?: unknown }).alt === "boolean" &&
    typeof (combo as { shift?: unknown }).shift === "boolean" &&
    typeof (combo as { meta?: unknown }).meta === "boolean"
  );
}

/**
 * A saved action. The shell's own types take no parameters; a type a plugin
 * declared is checked against its declaration, whether or not the plugin is
 * running. A type nobody declares (its plugin was removed) is only checked
 * loosely, so the rest of the list can still be saved, and whichever plugin
 * claims it later ignores what it cannot use.
 */
export function isValidKeybindingAction(action: unknown): boolean {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return false;
  }
  const record = action as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !ACTION_TYPE_PATTERN.test(type)) {
    return false;
  }
  if (CORE_KEYBINDING_ACTIONS.includes(type)) return true;
  const declared = findKeybindingAction(type);
  if (declared) return validateKeybindingActionParams(record, declared);
  return Object.entries(record).every(
    ([, value]) =>
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      (typeof value === "string" && value.length <= MAX_LOOSE_VALUE),
  );
}

export function isValidKeybinding(entry: unknown): boolean {
  return (
    !!entry &&
    typeof entry === "object" &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { enabled?: unknown }).enabled === "boolean" &&
    isValidKeyCombo((entry as { combo?: unknown }).combo) &&
    isValidKeybindingAction((entry as { action?: unknown }).action)
  );
}
