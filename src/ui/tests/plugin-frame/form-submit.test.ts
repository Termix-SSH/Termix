import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFormSubmitShim } from "@/plugin-frame/form-submit";

let uninstall: () => void = () => {};
let submits: Event[] = [];

function mount(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  const form = document.querySelector("form")!;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submits.push(event);
  });
  return form;
}

// jsdom never submits on Enter, like a frame without allow-forms.
function enter(el: Element, init: KeyboardEventInit = {}) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  submits = [];
  uninstall = installFormSubmitShim(window);
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("form submit shim", () => {
  it("fires submit on Enter in a lone field", () => {
    const form = mount(`<form><input id="q" /></form>`);
    enter(form.querySelector("#q")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(1);
  });

  it("does not fire twice when the browser submits itself", () => {
    const form = mount(`<form><input /><button>Go</button></form>`);
    form.querySelector("button")!.click();
    vi.runAllTimers();
    expect(submits).toHaveLength(1);
  });

  it("clicks the default button on Enter", () => {
    const form = mount(
      `<form><input id="q" /><button type="button">x</button><button type="submit">Go</button></form>`,
    );
    const clicked = vi.fn();
    form.querySelectorAll("button")[1].addEventListener("click", clicked);
    enter(form.querySelector("#q")!);
    vi.runAllTimers();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(submits).toHaveLength(1);
    expect((submits[0] as SubmitEvent).submitter?.textContent).toBe("Go");
  });

  it("skips a disabled default button", () => {
    const form = mount(
      `<form><input id="q" /><button disabled>Go</button></form>`,
    );
    enter(form.querySelector("#q")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(0);
  });

  it("leaves Enter alone when handled, composing or in a textarea", () => {
    const form = mount(`<form><input id="q" /><textarea></textarea></form>`);
    const input = form.querySelector("#q")!;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).shiftKey) e.preventDefault();
    });
    enter(input, { shiftKey: true });
    enter(input, { isComposing: true });
    enter(form.querySelector("textarea")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(0);
  });

  it("does not submit on Enter with two fields and no button", () => {
    const form = mount(`<form><input id="a" /><input id="b" /></form>`);
    enter(form.querySelector("#a")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(0);
  });

  it("checks validity first", () => {
    const form = mount(`<form><input id="q" required /></form>`);
    enter(form.querySelector("#q")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(0);
  });

  it("submits a password form on click and Enter when native submit is blocked", () => {
    const form = mount(
      `<form>
        <input id="passphrase" name="passphrase" type="password" value="s3cr3t" />
        <button type="button">Toggle</button>
        <button type="button">Cancel</button>
        <button type="submit">Connect</button>
      </form>`,
    );
    // Simulate a sandboxed frame without allow-forms: clicking submit never
    // triggers a native submit event from the browser.
    const submitBtn = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    vi.spyOn(submitBtn, "click").mockImplementation(() => {
      submitBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    submitBtn.click();
    vi.runAllTimers();
    expect(submits).toHaveLength(1);
    expect(
      (
        (submits[0].target as HTMLFormElement).elements.namedItem(
          "passphrase",
        ) as HTMLInputElement
      ).value,
    ).toBe("s3cr3t");

    enter(form.querySelector("#passphrase")!);
    vi.runAllTimers();
    expect(submits).toHaveLength(2);
    expect((submits[1] as SubmitEvent).submitter).toBe(submitBtn);
  });
});
