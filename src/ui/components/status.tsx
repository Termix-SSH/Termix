/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ListBadge } from "@/components/list-kit";

export type StatusTone = "ok" | "warn" | "bad" | "info" | "idle";

const DOT: Record<StatusTone, string> = {
  ok: "bg-green-500",
  warn: "bg-warning",
  bad: "bg-destructive",
  info: "bg-accent-brand",
  idle: "bg-muted-foreground/50",
};

const BADGE = {
  ok: "success",
  warn: "warning",
  bad: "destructive",
  info: "brand",
  idle: "muted",
} as const;

// Common state words, so most callers only pass the state.
const WORDS: Record<string, StatusTone> = {
  running: "ok",
  up: "ok",
  online: "ok",
  active: "ok",
  healthy: "ok",
  ready: "ok",
  ok: "ok",
  success: "ok",
  succeeded: "ok",
  done: "ok",
  completed: "ok",
  enabled: "ok",
  connected: "ok",
  bound: "ok",
  compliant: "ok",
  pending: "warn",
  paused: "warn",
  restarting: "warn",
  starting: "warn",
  stopping: "warn",
  waiting: "warn",
  degraded: "warn",
  warn: "warn",
  warning: "warn",
  unhealthy: "warn",
  drifted: "warn",
  pending_approval: "warn",
  needs_interaction: "warn",
  interrupted: "warn",
  update: "info",
  created: "idle",
  exited: "idle",
  stopped: "idle",
  inactive: "idle",
  disabled: "idle",
  offline: "bad",
  down: "bad",
  dead: "bad",
  failed: "bad",
  fail: "bad",
  error: "bad",
  crashloopbackoff: "bad",
};

/** The tone for a state word like "running" or "failed". Unknown words are idle. */
export function statusTone(state: string | null | undefined): StatusTone {
  if (!state) return "idle";
  const key = state.toLowerCase().replace(/[\s-]+/g, "_");
  return WORDS[key] ?? WORDS[key.replace(/_/g, "")] ?? "idle";
}

/** A small round status light. */
export function StatusDot({
  tone,
  state,
  pulse = false,
  className,
  title,
}: {
  tone?: StatusTone;
  /** A state word, used when no tone is given. */
  state?: string | null;
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  const resolved = tone ?? statusTone(state);
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        DOT[resolved],
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

/** A state as a small colored badge. The text is the state unless children are given. */
export function StatusBadge({
  tone,
  state,
  className,
  children,
}: {
  tone?: StatusTone;
  state?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const resolved = tone ?? statusTone(state);
  return (
    <ListBadge tone={BADGE[resolved]} className={className}>
      {children ?? state}
    </ListBadge>
  );
}
