import { isElectron } from "@/lib/electron";
import { getSyncStatus, type SyncStatus } from "@/api/sync-api";
import { notifySyncChanged } from "@/lib/linked-server";

/**
 * The desktop's sync status, polled from the embedded backend while anything
 * shows it. When a pass finishes, the views that show synced data are told
 * to reload.
 */

const IDLE_MS = 15_000;
const BUSY_MS = 2_000;

let snapshot: SyncStatus | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSyncAt: string | null | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function announce(): void {
  notifySyncChanged();
  window.dispatchEvent(new CustomEvent("hosts:refresh"));
  window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
  window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
  window.dispatchEvent(new CustomEvent("termix:plugins-changed"));
}

async function poll(): Promise<void> {
  timer = null;
  try {
    const next = await getSyncStatus();
    const syncedAt = next.lastSyncAt ?? null;
    if (lastSyncAt !== undefined && syncedAt !== lastSyncAt) announce();
    if (snapshot && snapshot.linked !== next.linked) notifySyncChanged();
    lastSyncAt = syncedAt;
    snapshot = next;
    emit();
  } catch {
    // The backend may still be starting; the next poll tries again.
  }
  schedule();
}

function schedule(delay?: number): void {
  if (listeners.size === 0 || timer) return;
  const busy = snapshot?.status === "syncing" || !!snapshot?.pending;
  timer = setTimeout(() => void poll(), delay ?? (busy ? BUSY_MS : IDLE_MS));
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (isElectron() && listeners.size === 1 && !timer) void poll();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function getSyncStatusSnapshot(): SyncStatus | null {
  return snapshot;
}

/** Takes a status a request already returned, and checks again soon. */
export function setSyncStatus(next: SyncStatus): void {
  snapshot = next;
  if (lastSyncAt !== undefined && (next.lastSyncAt ?? null) !== lastSyncAt) {
    announce();
  }
  lastSyncAt = next.lastSyncAt ?? null;
  emit();
  if (timer) clearTimeout(timer);
  timer = null;
  schedule(BUSY_MS);
}

export function refreshSyncStatus(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  void poll();
}
