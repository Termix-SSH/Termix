/** Lookup data the editor needs to turn ids into names. */
export interface AutomationEditorOptions {
  hosts: Array<{ id: number; name: string }>;
  snippets: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  fleets: Array<{ id: number; name: string }>;
}

export const EMPTY_EDITOR_OPTIONS: AutomationEditorOptions = {
  hosts: [],
  snippets: [],
  channels: [],
  fleets: [],
};

/** Short unique id for a new step, stable for the life of the automation. */
export function newStepId(): string {
  return `s${Math.random().toString(36).slice(2, 8)}`;
}
