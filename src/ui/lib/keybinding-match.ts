import type { CustomKeybinding, KeyCombo } from "@/types/keybindings";

export function eventMatchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  if (e.ctrlKey !== combo.ctrl) return false;
  if (e.altKey !== combo.alt) return false;
  if (e.shiftKey !== combo.shift) return false;
  if (e.metaKey !== combo.meta) return false;
  const actual = combo.isCode ? e.code : e.key.toLowerCase();
  return actual === combo.key;
}

export function findMatchingKeybinding(
  e: KeyboardEvent,
  bindings: CustomKeybinding[],
): CustomKeybinding | undefined {
  return bindings.find((kb) => eventMatchesCombo(e, kb.combo));
}
