import { useSyncExternalStore } from "react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { ShareSessionModal } from "./ShareSessionModal";
import type { SessionShareProtocol } from "./api";
import { sessionPublicUrl } from "./meeting-backend";

let shareApp: TermixApp | null = null;

export function bindShareApp(app: TermixApp | null): void {
  shareApp = app;
}

function resolveShareBase(
  origin: "local" | "remote" | undefined,
): Promise<string | null> {
  if (!shareApp) return Promise.resolve(window.location.href);
  return sessionPublicUrl(shareApp, origin);
}

/** What the share dialog needs to share one live session. */
export interface ShareTarget {
  hostId: number;
  sessionId: string;
  protocol: SessionShareProtocol;
  tabInstanceId?: string;
  /** The backend the session runs on; a desktop can be on either. */
  origin?: "local" | "remote";
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
      origin={target.origin}
      resolvePublicUrl={resolveShareBase}
    />
  );
}
