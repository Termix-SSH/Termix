export function isShiftKey(event: Pick<KeyboardEvent, "key" | "code">) {
  return (
    event.key === "Shift" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight"
  );
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
