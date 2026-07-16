import { isElectron } from "./electron";

export function installElectronWheelZoomGuard(): () => void {
  if (!isElectron()) return () => {};

  const preventModifierWheelZoom = (event: WheelEvent) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
  };

  window.addEventListener("wheel", preventModifierWheelZoom, {
    capture: true,
    passive: false,
  });

  return () =>
    window.removeEventListener("wheel", preventModifierWheelZoom, {
      capture: true,
    });
}
