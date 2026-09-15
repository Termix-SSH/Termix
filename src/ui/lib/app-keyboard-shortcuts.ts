export function isShiftKey(event: Pick<KeyboardEvent, "key" | "code">) {
  return (
    event.key === "Shift" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight"
  );
}

export function getAltDigitShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
) {
  const match = /^Digit([1-9])$/.exec(event.code);
  return match && event.key === match[1] ? Number(match[1]) : null;
}

export function dispatchCtrlW(target: EventTarget | null) {
  if (!target) return false;

  const event = new KeyboardEvent("keydown", {
    key: "w",
    code: "KeyW",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  return !target.dispatchEvent(event);
}
