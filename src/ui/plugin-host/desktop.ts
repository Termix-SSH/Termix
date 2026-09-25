/** app.desktop: the desktop app's remote sync connection, for plugins. */

import { isElectron } from "@/lib/electron";

export async function remoteServerUrl(): Promise<string | null> {
  if (!isElectron()) return null;
  try {
    const config = (await window.electronAPI?.invoke?.(
      "get-remote-sync-config",
    )) as { serverUrl?: string } | null | undefined;
    return config?.serverUrl || null;
  } catch {
    return null;
  }
}

export function onRemoteServerChange(listener: () => void): () => void {
  const unsubscribe = window.electronAPI?.onRemoteSyncStatusChanged?.(() =>
    listener(),
  );
  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}
