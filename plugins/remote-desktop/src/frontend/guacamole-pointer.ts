import Guacamole from "guacamole-common-js";
import {
  createScrollCoalescer,
  isScrollButtonState,
} from "./guacamole-scroll.js";

export type GuacamoleTouchMode = "touchscreen" | "touchpad";

/**
 * Guacamole.Mouse listens for mousedown/mousemove/mouseup; the Touchscreen and
 * Touchpad emulators listen only for touch events. The two sets do not overlap,
 * so binding one instead of the other leaves that input dead.
 *
 * A touch-capable device is not a device without a pointer: laptops with a
 * touchscreen report maxTouchPoints > 0 and are still driven by a mouse. The
 * physical pointer is therefore always bound, and a touch emulator is layered
 * on top when one is selected.
 */
export function bindPointerInput(
  element: HTMLElement,
  touchMode: GuacamoleTouchMode | null | undefined,
  onState: (state: Guacamole.Mouse.State) => void,
): () => void {
  const coalescer = createScrollCoalescer((state) => {
    onState(state as Guacamole.Mouse.State);
  });
  let expectingScrollRelease = false;

  const handleState = (state: Guacamole.Mouse.State) => {
    coalescer.notePointer(state);
    if (isScrollButtonState(state)) {
      coalescer.ingestClick(state.down ? 1 : -1);
      expectingScrollRelease = true;
      return;
    }
    if (
      expectingScrollRelease &&
      !state.left &&
      !state.middle &&
      !state.right
    ) {
      expectingScrollRelease = false;
      return;
    }
    expectingScrollRelease = false;
    onState(state);
  };

  const mouse = new Guacamole.Mouse(element);
  mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = handleState;

  if (touchMode === "touchscreen") {
    const touchscreen = new Guacamole.Mouse.Touchscreen(element);
    touchscreen.onEach(["mousedown", "mousemove", "mouseup"], (event) =>
      handleState(event.state),
    );
  } else if (touchMode === "touchpad") {
    const touchpad = new Guacamole.Mouse.Touchpad(element);
    touchpad.onEach(["mousedown", "mousemove", "mouseup"], (event) =>
      handleState(event.state),
    );
  }

  return () => coalescer.dispose();
}
