/** Buttons shared by every PanePrompt, so confirms and prompts match. */
export const PROMPT_BUTTON =
  "inline-flex h-7 items-center justify-center gap-1.5 border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const PROMPT_PRIMARY_BUTTON =
  "inline-flex h-7 items-center justify-center gap-1.5 border border-accent-brand/40 px-3 text-xs font-medium text-accent-brand transition-colors hover:bg-accent-brand/10 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const PROMPT_DESTRUCTIVE_BUTTON =
  "inline-flex h-7 items-center justify-center gap-1.5 bg-destructive px-3 text-xs font-medium text-white transition-colors hover:bg-destructive/90 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
