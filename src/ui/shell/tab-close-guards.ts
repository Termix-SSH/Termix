type Guard = () => boolean | Promise<boolean>;

const guards = new Map<string, Guard>();

/**
 * Lets a tab with no session handle, like Manage, ask before it closes.
 * Returns the unregister function.
 */
export function registerTabCloseGuard(tabId: string, guard: Guard): () => void {
  guards.set(tabId, guard);
  return () => {
    if (guards.get(tabId) === guard) guards.delete(tabId);
  };
}

/** Whether the tab may close: true when it has no guard or the guard agrees. */
export async function canCloseTab(tabId: string): Promise<boolean> {
  const guard = guards.get(tabId);
  return guard ? await guard() : true;
}
