const VALID_ACTION_TYPES = [
  "copy",
  "paste",
  "sendControlCode",
  "sendText",
  "runSnippet",
];

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

export function isValidKeybindingAction(action: unknown): boolean {
  if (!action || typeof action !== "object") return false;
  const type = (action as { type?: unknown }).type;
  if (typeof type !== "string" || !VALID_ACTION_TYPES.includes(type))
    return false;
  if (type === "sendText") {
    return typeof (action as { text?: unknown }).text === "string";
  }
  if (type === "sendControlCode") {
    const code = (action as { controlCode?: unknown }).controlCode;
    return typeof code === "string" && /^[a-zA-Z]$/.test(code);
  }
  if (type === "runSnippet") {
    return typeof (action as { snippetId?: unknown }).snippetId === "string";
  }
  return true;
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
