import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
}

// iOS Safari/WKWebView reports keyCode 229 for ordinary software-keyboard
// input, not just true IME composition, so xterm routes typing through
// CompositionHelper.keydown -> _handleAnyTextareaChanges instead of the
// normal keypress path. That handler snapshots the textarea value on
// keydown, then diffs it against the value a setTimeout(0) later.
function dispatchIOSKeydown(textarea: HTMLTextAreaElement) {
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", { keyCode: 229 } as KeyboardEventInit),
  );
}

describe("iOS rapid typing (keyCode 229 outside composition)", () => {
  let terminal: Terminal | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    terminal?.dispose();
    container?.remove();
    terminal = undefined;
    container = undefined;
  });

  it("forwards a mid-word autocorrect rewrite instead of dropping it", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    terminal = new Terminal();
    terminal.open(container);

    const input: string[] = [];
    terminal.onData((data) => input.push(data));

    const textarea = terminal.textarea!;

    // keydown fires while the textarea still holds the pre-keystroke value;
    // the browser (or, on iOS, autocorrect) mutates the value afterward.
    // Autocorrect can rewrite characters earlier in the word, not just
    // append at the cursor, so the old value is no longer a literal
    // substring of the new one.
    dispatchIOSKeydown(textarea);
    setTextareaValue(textarea, "wrold");
    await tick();

    dispatchIOSKeydown(textarea);
    setTextareaValue(textarea, "world");
    await tick();

    expect(input.join("")).toBe("wrold" + "orld");
  });
});
