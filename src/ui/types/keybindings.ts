export interface KeyCombo {
  key: string;
  isCode: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type KeybindingActionType =
  | "copy"
  | "paste"
  | "sendControlCode"
  | "sendText"
  | "runSnippet";

export interface KeybindingAction {
  type: KeybindingActionType;
  text?: string;
  controlCode?: string;
  snippetId?: string;
  appendEnter?: boolean;
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
