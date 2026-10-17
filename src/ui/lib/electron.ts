type ElectronWindow = Window &
  typeof globalThis & {
    IS_ELECTRON?: boolean;
    electronAPI?: {
      isElectron?: boolean;
      backendPort?: number;
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

const DEFAULT_LOCAL_BACKEND_PORT = 30001;

/**
 * The port of the desktop app's embedded backend. It moves off 30001 when
 * another program holds that port.
 */
export function localBackendPort(): number {
  if (typeof window === "undefined") return DEFAULT_LOCAL_BACKEND_PORT;
  const port = (window as ElectronWindow).electronAPI?.backendPort;
  return typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536
    ? port
    : DEFAULT_LOCAL_BACKEND_PORT;
}
