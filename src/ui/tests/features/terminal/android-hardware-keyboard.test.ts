import { describe, expect, it } from "vitest";
import { getAndroidHardwareKeySequence } from "@/features/terminal/android-hardware-keyboard";

const key = (
  value: string,
  modifiers: Partial<KeyboardEvent> = {},
): Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
> => ({
  key: value,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("getAndroidHardwareKeySequence", () => {
  it("maps cursor keys in normal and application modes", () => {
    expect(
      getAndroidHardwareKeySequence(key("ArrowUp"), false, undefined),
    ).toBe("\x1b[A");
    expect(getAndroidHardwareKeySequence(key("ArrowUp"), true, undefined)).toBe(
      "\x1bOA",
    );
  });

  it("maps Delete and the default Backspace mode", () => {
    expect(getAndroidHardwareKeySequence(key("Delete"), false, undefined)).toBe(
      "\x1b[3~",
    );
    expect(
      getAndroidHardwareKeySequence(key("Backspace"), false, undefined),
    ).toBe("\x7f");
  });

  it("leaves control-h Backspace and modified keys to existing handlers", () => {
    expect(
      getAndroidHardwareKeySequence(key("Backspace"), false, "control-h"),
    ).toBeNull();
    expect(
      getAndroidHardwareKeySequence(
        key("ArrowLeft", { ctrlKey: true }),
        false,
        undefined,
      ),
    ).toBeNull();
  });
});
