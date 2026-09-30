/** app.desktop: the server this desktop is linked to, for plugins. */

import { getLinkedSession } from "@/lib/linked-server";
import { SYNC_CHANGED_EVENT } from "@/lib/sync-events";

type RemoteServerSource = () => string | null | Promise<string | null>;

let testSource: RemoteServerSource | null = null;

/** renderWithApp's stand-in for the linked server. */
export function setRemoteServerUrlForTesting(
  source: RemoteServerSource | null,
): void {
  testSource = source;
}

export async function remoteServerUrl(): Promise<string | null> {
  if (testSource) return (await testSource()) ?? null;
  return (await getLinkedSession())?.serverUrl ?? null;
}

export function onRemoteServerChange(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(SYNC_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SYNC_CHANGED_EVENT, handler);
}
