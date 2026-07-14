import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Android IME composition", () => {
  let terminal: Terminal | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    terminal?.dispose();
    container?.remove();
    terminal = undefined;
    container = undefined;
  });

  it("forwards a shorter Vietnamese replacement to the shell", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    terminal = new Terminal();
    terminal.open(container);

    const input: string[] = [];
    terminal.onData((data) => input.push(data));

    const textarea = terminal.textarea!;
    textarea.value = "Hoar";
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
    textarea.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { data: "Hoar" }),
    );
    await tick();

    textarea.value = "Hỏa";
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { data: "Hỏa" }),
    );
    await tick();
    textarea.dispatchEvent(new CompositionEvent("compositionend"));
    await tick();

    expect(input.join("")).toBe("\x7f\x7f\x7fỏa");
  });
});
