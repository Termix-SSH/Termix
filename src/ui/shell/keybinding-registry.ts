import type { ComponentType } from "react";
import type { KeybindingAction, KeyCombo } from "@/types/keybindings";
import { byOrderThenId, createRegistry } from "@/lib/registry";

export interface KeybindingEditorProps {
  action: KeybindingAction;
  onChange: (action: KeybindingAction) => void;
}

export interface KeybindingRunContext {
  sessionId?: string;
  host?: {
    ip?: string;
    username?: string;
    port?: number | string;
    name?: string;
  } | null;
  send?: (data: string) => void;
}

/**
 * An action a key can be bound to. The shell registers its own; plugins add
 * theirs with app.registerKeybindingAction. `id` is what a saved binding
 * stores as action.type.
 */
export interface KeybindingActionDef {
  id: string;
  pluginId?: string;
  /** A full translation key. */
  labelKey: string;
  scope: "session" | "global";
  editor?: ComponentType<KeybindingEditorProps>;
  summary?: ComponentType<KeybindingEditorProps>;
  /** A full translation key when the action cannot be saved yet. */
  validate?: (action: KeybindingAction) => string | null;
  run?: (action: KeybindingAction, context: KeybindingRunContext) => void;
  order?: number;
}

/** A built-in key the user can rebind. */
export interface KeybindingDefaultDef {
  id: string;
  pluginId?: string;
  combo: KeyCombo;
  /** A full translation key. */
  descriptionKey: string;
  order?: number;
}

/** Fired for the shell's own actions; AppShell runs them. */
export const GLOBAL_KEYBINDING_EVENT = "termix:global-keybinding";

function shellAction(id: string, labelKey: string, order: number) {
  return {
    id,
    labelKey,
    scope: "global" as const,
    order,
    run: (action: KeybindingAction) => {
      window.dispatchEvent(
        new CustomEvent(GLOBAL_KEYBINDING_EVENT, {
          detail: { type: action.type },
        }),
      );
    },
  };
}

/** The actions the shell runs itself. */
const SHELL_ACTIONS: KeybindingActionDef[] = [
  shellAction("nextTab", "newUi.sidebar.keybindings.actionNextTab", 1000),
  shellAction(
    "previousTab",
    "newUi.sidebar.keybindings.actionPreviousTab",
    1001,
  ),
  shellAction(
    "openCommandPalette",
    "newUi.sidebar.keybindings.actionOpenCommandPalette",
    1002,
  ),
  shellAction(
    "reconnectSession",
    "newUi.sidebar.keybindings.actionReconnectSession",
    1003,
  ),
];

export const SHELL_KEYBINDING_ACTION_IDS = SHELL_ACTIONS.map(
  (action) => action.id,
);

const actions = createRegistry<KeybindingActionDef>(byOrderThenId);
const defaults = createRegistry<KeybindingDefaultDef>(byOrderThenId);

function install(): void {
  for (const action of SHELL_ACTIONS) {
    if (!actions.get(action.id)) actions.register(action);
  }
}
install();

/** Adds a plugin's action. A shell action's id cannot be taken over. */
export function registerKeybindingAction(
  action: KeybindingActionDef,
): () => void {
  if (SHELL_KEYBINDING_ACTION_IDS.includes(action.id)) {
    throw new Error(`Keybinding action "${action.id}" belongs to the shell`);
  }
  const existing = actions.get(action.id);
  if (existing && existing.pluginId !== action.pluginId) {
    throw new Error(
      `Keybinding action "${action.id}" is already registered by ${existing.pluginId}`,
    );
  }
  return actions.register(action);
}

export const registerKeybindingDefault = defaults.register;
export const listKeybindingActions = actions.list;
export const useKeybindingActions = actions.useList;
export const getKeybindingAction = actions.get;
export const listKeybindingDefaults = defaults.list;
export const useKeybindingDefaults = defaults.useList;

/** Back to the shell's own actions and no defaults, for tests. */
export function resetKeybindingRegistry(): void {
  actions.reset();
  defaults.reset();
  install();
}

/**
 * Runs a bound action through whoever registered it. False when nothing
 * running handles its type (its plugin is off), so the caller can let the
 * key through.
 */
export function runKeybindingAction(
  action: KeybindingAction,
  context: KeybindingRunContext = {},
): boolean {
  const def = actions.get(action.type);
  if (!def?.run) return false;
  try {
    def.run(action, context);
  } catch (error) {
    console.error(`[keybindings] ${action.type} failed`, error);
  }
  return true;
}
