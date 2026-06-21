import { useState, useEffect } from "react";

export type StatusColorScheme = "accent" | "status";

export function useStatusColorScheme(): StatusColorScheme {
  const [scheme, setScheme] = useState<StatusColorScheme>(
    () =>
      (localStorage.getItem("statusColorScheme") as StatusColorScheme) ??
      "accent",
  );

  useEffect(() => {
    const handler = () => {
      setScheme(
        (localStorage.getItem("statusColorScheme") as StatusColorScheme) ??
          "accent",
      );
    };
    window.addEventListener("statusColorSchemeChanged", handler);
    return () =>
      window.removeEventListener("statusColorSchemeChanged", handler);
  }, []);

  return scheme;
}

/** Returns Tailwind class names for a status dot/stripe. */
export function getStatusClasses(
  online: boolean,
  scheme: StatusColorScheme,
  variant: "dot" | "stripe" | "badge",
): string {
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
  if (variant === "stripe")
    return online ? "bg-accent-brand" : "bg-transparent";
  // badge
  return online
    ? "border-accent-brand/40 text-accent-brand bg-accent-brand/10"
    : "border-border/50 text-muted-foreground/60 bg-muted/30";
}
