export type TerminalContextMenuAction = "native" | "copy" | "paste";

export function resolveTerminalContextMenuAction({
  rightClickCopyPaste,
  copyOnSelect,
  hasSelection,
}: {
  rightClickCopyPaste: boolean;
  copyOnSelect: boolean;
  hasSelection: boolean;
}): TerminalContextMenuAction {
  if (!rightClickCopyPaste) return "native";
  return hasSelection && !copyOnSelect ? "copy" : "paste";
}

export function selectedTextToCopy({
  copyOnSelect,
  button,
  selection,
}: {
  copyOnSelect: boolean;
  button: number;
  selection: string;
}): string | null {
  return copyOnSelect && button === 0 && selection ? selection : null;
}
