import type { AuditLogParams } from "./audit-logger.js";

export interface AuditHookEntry extends AuditLogParams {
  timestamp: Date;
}

type AuditHook = (entry: AuditHookEntry) => void;

const hooks = new Set<AuditHook>();

/** Registers a listener for accepted audit lines. Returns the remover. */
export function onAuditEntry(hook: AuditHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** Never throws and never waits: a hook cannot delay the audited action. */
export function emitAuditEntry(params: AuditLogParams): void {
  if (hooks.size === 0) return;
  const entry: AuditHookEntry = { ...params, timestamp: new Date() };
  for (const hook of hooks) {
    queueMicrotask(() => {
      try {
        hook(entry);
      } catch {
        // a plugin hook must not break auditing
      }
    });
  }
}
