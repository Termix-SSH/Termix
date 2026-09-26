/** app.desktop: the server this desktop is linked to, for plugins. */

import { getLinkedSession } from "@/lib/linked-server";
import { SYNC_CHANGED_EVENT } from "@/lib/sync-events";

export async function remoteServerUrl(): Promise<string | null> {
  return (await getLinkedSession())?.serverUrl ?? null;
}

export function onRemoteServerChange(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(SYNC_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SYNC_CHANGED_EVENT, handler);
}
