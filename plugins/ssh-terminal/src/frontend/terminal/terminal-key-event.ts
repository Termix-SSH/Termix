export function isTabKeyEvent(event: KeyboardEvent): boolean {
  return event.key === "Tab" || event.code === "Tab" || event.keyCode === 9;
}

export function isPhysicalShortcutKey(
  event: Pick<KeyboardEvent, "code" | "key">,
  code: string,
  fallbackKey: string,
): boolean {
  return event.code
    ? event.code === code
    : event.key.toLowerCase() === fallbackKey;
}
