type ElectronWindow = Window &
  typeof globalThis & {
    IS_ELECTRON?: boolean;
    electronAPI?: { isElectron?: boolean };
  };

/** Serial is always local: the device is physically attached to this desktop machine. */
export function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as ElectronWindow;
  return (
    win.IS_ELECTRON === true ||
    !!win.electronAPI ||
    win.electronAPI?.isElectron === true
  );
}
