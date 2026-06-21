// Module-level ref so xterm's key handler can invoke app-level shortcuts
// without going through synthetic DOM events.
export const globalShortcutHandler = {
  current: null as ((e: KeyboardEvent) => void) | null,
};
