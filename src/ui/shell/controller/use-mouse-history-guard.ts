import { useEffect } from "react";

/** The mouse's back and forward side buttons. */
export function isMouseHistoryButton(event: MouseEvent): boolean {
  return event.button === 3 || event.button === 4;
}

/**
 * The browser treats the mouse back button as page back, which leaves
 * Termix. Views that have their own history, like the file manager, still
 * get the click; only the browser's navigation is stopped.
 */
export function useMouseHistoryGuard(): void {
  useEffect(() => {
    const stop = (event: MouseEvent) => {
      if (isMouseHistoryButton(event)) event.preventDefault();
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("auxclick", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("auxclick", stop);
    };
  }, []);
}
