type ElectronWindow = Window &
  typeof globalThis & {
    IS_ELECTRON?: boolean;
    electronAPI?: {
      isElectron?: boolean;
    };
  };

export function isElectron(): boolean {
  if (typeof window === "undefined") return false;

  const win = window as ElectronWindow;
  const hasISElectron = win.IS_ELECTRON === true;
  const hasElectronAPI = !!win.electronAPI;
  const isElectronProp = win.electronAPI?.isElectron === true;

  return hasISElectron || hasElectronAPI || isElectronProp;
}
