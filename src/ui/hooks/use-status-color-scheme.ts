import { useState, useEffect } from "react";
import type { StatusColorScheme } from "@/types/host-sidebar-preferences";

export type { StatusColorScheme };

const PREFS_KEY = "hostSidebarPreferences";
const PREFS_EVENT = "hostSidebarPreferencesChanged";

/**
 * Reads the scheme straight off the sidebar preferences cache that
 * useHostSidebarPreferences writes, so the toggle in Customize Sidebar takes
 * effect without a reload. Exported for imperative callers that build markup
 * outside React (the topology SVG).
 */
export function readStatusColorScheme(): StatusColorScheme {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return "accent";
    const parsed = JSON.parse(raw) as {
      display?: { statusColorScheme?: string };
    };
    return parsed?.display?.statusColorScheme === "status"
      ? "status"
      : "accent";
  } catch {
    return "accent";
  }
}

export function useStatusColorScheme(): StatusColorScheme {
  const [scheme, setScheme] = useState<StatusColorScheme>(
    readStatusColorScheme,
  );

  useEffect(() => {
    const handler = () => setScheme(readStatusColorScheme());
    handler();
    window.addEventListener(PREFS_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(PREFS_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return scheme;
}

/** Returns Tailwind class names for a status dot/stripe. */
export function getStatusClasses(
  status: boolean | "online" | "reachable" | "offline" | "degraded",
  scheme: StatusColorScheme,
  variant: "dot" | "stripe" | "badge",
  loading = false,
): string {
  const online = status === true || status === "online";
  const reachable = status === "reachable";
  if (loading) {
    if (scheme === "status") {
      if (variant === "dot") return "bg-yellow-400 animate-pulse";
      if (variant === "stripe") return "bg-yellow-400/40 animate-pulse";
      return "border-yellow-400/40 text-yellow-400 bg-yellow-400/10 animate-pulse";
    }
    if (variant === "dot") return "bg-muted-foreground/40 animate-pulse";
    if (variant === "stripe") return "bg-muted-foreground/20 animate-pulse";
    return "border-border/50 text-muted-foreground/50 bg-muted/20 animate-pulse";
  }
  if (reachable) {
    if (variant === "dot") return "bg-amber-400";
    if (variant === "stripe") return "bg-amber-400/50";
    return "border-amber-400/40 text-amber-400 bg-amber-400/10";
  }
  if (scheme === "status") {
    if (variant === "dot") return online ? "bg-emerald-500" : "bg-red-500";
    if (variant === "stripe")
      return online ? "bg-emerald-500" : "bg-red-500/40";
    // badge
    return online
      ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
      : "border-red-500/40 text-red-500 bg-red-500/10";
  }
  // accent scheme
  if (variant === "dot")
    return online ? "bg-accent-brand" : "bg-muted-foreground/25";
  // Offline keeps a faint neutral line rather than nothing, so the stripe
  // column stays visible instead of blending into the background.
  if (variant === "stripe")
    return online ? "bg-accent-brand" : "bg-muted-foreground/20";
  // badge
  return online
    ? "border-accent-brand/40 text-accent-brand bg-accent-brand/10"
    : "border-border/50 text-muted-foreground/60 bg-muted/30";
}
