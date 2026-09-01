import type { LucideIcon } from "lucide-react";
import { useAreaPreferences } from "@/contexts/UiPreferencesContext";

/**
 * Shared empty state. Every feature used to hand-roll its own, so some
 * surfaces explained what to do next and others showed a bare line of text.
 *
 * The `hint` and `action` only render at "guided" verbosity, which the Simple
 * preset turns on: someone who has just picked the simplest interface is the
 * one who most needs telling what to do next, while an experienced user on
 * Advanced does not want the extra paragraph on every empty panel.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  /** Guidance shown only at "guided" verbosity. */
  hint?: string;
  /** Primary call to action, also guided-only. */
  action?: React.ReactNode;
  className?: string;
}) {
  const { emptyStateVerbosity } = useAreaPreferences("chrome");
  const guided = emptyStateVerbosity === "guided";

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-4 py-8 text-center ${className ?? ""}`}
    >
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground/40" />}
      <span className="text-xs text-muted-foreground">{title}</span>
      {guided && hint && (
        <span className="max-w-xs text-[11px] leading-snug text-muted-foreground/70">
          {hint}
        </span>
      )}
      {guided && action}
    </div>
  );
}
