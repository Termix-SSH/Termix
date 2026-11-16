/**
 * For a view the shell placed over another plugin's frame: Tab past the
 * first or last control hands focus back to that frame, and a wheel move
 * nothing here can scroll goes to it too.
 */

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function tabbables(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) =>
      !element.closest("[inert]") &&
      element.getClientRects().length > 0 &&
      element.tabIndex >= 0,
  );
}

type Out = (dir: "next" | "prev") => void;

/** Focus came in from the frame around: start at the first or last control. */
export function focusEdge(edge: "first" | "last", out: Out): void {
  const all = tabbables();
  const target = edge === "first" ? all[0] : all[all.length - 1];
  if (target) target.focus();
  // Nothing to focus here: let focus carry on past this view.
  else out(edge === "first" ? "next" : "prev");
}

/** Whether something under the pointer can still scroll this way. */
export function canScroll(
  start: Element | null,
  dx: number,
  dy: number,
): boolean {
  let node: Element | null = start;
  while (node) {
    const style = getComputedStyle(node);
    if (dy !== 0 && /(auto|scroll|overlay)/.test(style.overflowY)) {
      const max = node.scrollHeight - node.clientHeight;
      if (max > 0 && (dy < 0 ? node.scrollTop > 0 : node.scrollTop < max - 1)) {
        return true;
      }
    }
    if (dx !== 0 && /(auto|scroll|overlay)/.test(style.overflowX)) {
      const max = node.scrollWidth - node.clientWidth;
      if (
        max > 0 &&
        (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft < max - 1)
      ) {
        return true;
      }
    }
    node = node.parentElement;
  }
  const page = document.scrollingElement;
  if (page && dy !== 0) {
    const max = page.scrollHeight - page.clientHeight;
    if (max > 0 && (dy < 0 ? page.scrollTop > 0 : page.scrollTop < max - 1)) {
      return true;
    }
  }
  return false;
}

export function watchEdges(send: (name: string, data: unknown) => void): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const all = tabbables();
      const active = document.activeElement;
      const index = active ? all.indexOf(active as HTMLElement) : -1;
      const leaving = event.shiftKey
        ? index <= 0
        : index === -1 || index === all.length - 1;
      if (!leaving) return;
      event.preventDefault();
      (active as HTMLElement | null)?.blur?.();
      send("focusOut", { dir: event.shiftKey ? "prev" : "next" });
    },
    true,
  );

  let dx = 0;
  let dy = 0;
  let frame = 0;
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) return;
      if (
        canScroll(event.target as Element | null, event.deltaX, event.deltaY)
      ) {
        return;
      }
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      dx += event.deltaX * unit;
      dy += event.deltaY * unit;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        send("wheel", { dx, dy });
        dx = 0;
        dy = 0;
      });
    },
    { passive: true, capture: true },
  );
}
