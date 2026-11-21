/**
 * Plugin frames are sandboxed without allow-forms, so the browser drops a
 * form submit before the submit event fires. Plugins only ever handle the
 * event and call preventDefault, so this fires it for them when the browser
 * did not. Nothing is ever sent anywhere: the frame still can't navigate.
 */

const IMPLICIT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

function submitterOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("button, input");
  if (el instanceof HTMLButtonElement && el.type === "submit") return el;
  if (
    el instanceof HTMLInputElement &&
    (el.type === "submit" || el.type === "image")
  ) {
    return el;
  }
  return null;
}

function blocksImplicit(form: HTMLFormElement): boolean {
  let fields = 0;
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement && IMPLICIT_TYPES.has(el.type)) {
      fields += 1;
    }
  }
  return fields > 1;
}

export function installFormSubmitShim(win: Window = window): () => void {
  const doc = win.document;
  const seen = new WeakMap<HTMLFormElement, number>();
  const pending = new WeakSet<HTMLFormElement>();
  let tick = 0;

  const fire = (form: HTMLFormElement, submitter: HTMLElement | null) => {
    if (pending.has(form)) return;
    pending.add(form);
    const asked = ++tick;
    win.setTimeout(() => {
      pending.delete(form);
      // The browser fired it itself (no sandbox, or a browser that allows it).
      if ((seen.get(form) ?? 0) >= asked) return;
      if (!form.isConnected) return;
      const novalidate =
        form.noValidate ||
        (submitter as HTMLButtonElement | null)?.formNoValidate === true;
      if (!novalidate && !form.reportValidity()) return;
      const init = { bubbles: true, cancelable: true, submitter };
      const event =
        typeof SubmitEvent === "function"
          ? new SubmitEvent("submit", init)
          : new Event("submit", init);
      form.dispatchEvent(event);
    }, 0);
  };

  const onSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) {
      seen.set(event.target, ++tick);
    }
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const submitter = submitterOf(event.target);
    if (!submitter) return;
    const form = (submitter as HTMLButtonElement | HTMLInputElement).form;
    if (!form || (submitter as HTMLButtonElement).disabled) return;
    fire(form, submitter);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) {
      return;
    }
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!IMPLICIT_TYPES.has(input.type) || !input.form) return;
    const form = input.form;
    const button = submitterOf(
      form.querySelector("button:not([type]), [type=submit], [type=image]"),
    );
    if (button) {
      // Click the default button like the browser would; onClick does the rest.
      if ((button as HTMLButtonElement).disabled) return;
      button.click();
      event.preventDefault();
      return;
    }
    if (blocksImplicit(form)) return;
    fire(form, null);
  };

  doc.addEventListener("submit", onSubmit, true);
  win.addEventListener("click", onClick);
  win.addEventListener("keydown", onKeyDown);
  return () => {
    doc.removeEventListener("submit", onSubmit, true);
    win.removeEventListener("click", onClick);
    win.removeEventListener("keydown", onKeyDown);
  };
}
