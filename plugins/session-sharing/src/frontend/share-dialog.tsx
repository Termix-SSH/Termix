import { useSyncExternalStore } from "react";
import { ShareSessionModal } from "./ShareSessionModal";
import type { SessionShareProtocol } from "./api";

/** What the share dialog needs to share one live session. */
export interface ShareTarget {
  hostId: number;
  sessionId: string;
  protocol: SessionShareProtocol;
  tabInstanceId?: string;
}

let current: ShareTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Opens the share dialog, which the shell overlay slot keeps mounted. */
export function openShareDialog(target: ShareTarget): void {
  current = target;
  emit();
}

export function closeShareDialog(): void {
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Rendered once in "shell.overlay"; shows the dialog when a toolbar asks. */
export function ShareDialogHost() {
  const target = useSyncExternalStore(subscribe, () => current);
  if (!target) return null;
  return (
    <ShareSessionModal
      open
      onClose={closeShareDialog}
      hostId={target.hostId}
      sessionId={target.sessionId}
      protocol={target.protocol}
      tabInstanceId={target.tabInstanceId}
    />
  );
}
