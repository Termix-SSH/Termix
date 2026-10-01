export interface KeyCombo {
  key: string;
  isCode: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/**
 * The shell's own actions (nextTab, previousTab, openCommandPalette,
 * reconnectSession) or one a plugin declared in contributes.keybindingActions.
 */
export type KeybindingActionType = string;

/** A bound action: its type plus the parameters its declaration lists. */
export interface KeybindingAction {
  type: KeybindingActionType;
  [param: string]: unknown;
}

export interface CustomKeybinding {
  id: string;
  combo: KeyCombo;
  action: KeybindingAction;
  enabled: boolean;
  overridesDefaultId?: string;
  createdAt: string;
  updatedAt: string;
}
