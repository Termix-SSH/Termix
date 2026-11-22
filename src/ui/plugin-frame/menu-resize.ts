/**
 * A frame sized to its content grows while a menu is open, so the menu has
 * room (withOpenMenus in frame-root). Growing resizes the frame's window,
 * and a Radix Select closes on any window resize: it shut again the moment
 * it opened. A resize that only changes the height while a menu is open is
 * that growth, so it stops here before it reaches the menu. A real resize
 * changes the width too and still closes it.
 */

const OPEN_MENU = "[data-radix-popper-content-wrapper]";

export function installMenuResizeShim(win: Window = window): () => void {
  let width = win.innerWidth;
  const onResize = (event: Event) => {
    const sameWidth = win.innerWidth === width;
    width = win.innerWidth;
    if (sameWidth && win.document.querySelector(OPEN_MENU)) {
      event.stopImmediatePropagation();
    }
  };
  // Added before any plugin code runs, so it is the first resize listener.
  win.addEventListener("resize", onResize);
  return () => win.removeEventListener("resize", onResize);
}
