import { isElectron } from "@/lib/electron";

export async function requestRemoteSync(): Promise<void> {
  if (!isElectron()) return;

  try {
    const config = (await window.electronAPI?.invoke?.(
      "get-remote-sync-config",
    )) as { serverUrl?: string } | null;
    if (config?.serverUrl) {
      await window.electronAPI?.invoke?.("remote-sync-now");
    }
  } catch {
    // The periodic sync remains the fallback when IPC or the server is down.
  }
}
