import { useEffect, useRef } from "react";

/** The mouse's back and forward side buttons. */
export function isMouseHistoryButton(event: MouseEvent): boolean {
  return event.button === 3 || event.button === 4;
}

/**
 * The browser treats the mouse back button as page back, which leaves
 * Termix. The side buttons move between tabs instead. A view with its own
 * history, like the file manager, claims the click by calling
 * preventDefault before it reaches the window.
 */
export function useMouseHistoryGuard(nav?: {
  back: () => void;
  forward: () => void;
}): void {
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (!isMouseHistoryButton(event)) return;
      const claimed = event.defaultPrevented;
      event.preventDefault();
      if (claimed) return;
      if (event.button === 3) navRef.current?.back();
      else navRef.current?.forward();
    };
    const stop = (event: MouseEvent) => {
      if (isMouseHistoryButton(event)) event.preventDefault();
    };
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("auxclick", stop);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("auxclick", stop);
    };
  }, []);
}
