import type { TermixApp } from "@termix/plugin-sdk/frontend";

let current: TermixApp | null = null;

/** Set in activate, cleared on deactivate. */
export function setAiApp(app: TermixApp | null): void {
  current = app;
}

export function aiApp(): TermixApp {
  if (!current) throw new Error("The AI plugin is not active");
  return current;
}
