import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A block that explains why a view has nothing to show yet and what to do,
 * like "Samba is not installed" with an Install button. Unlike EmptyState the
 * action always shows.
 */
export function NoticePanel({
  icon: Icon,
  title,
  children,
  action,
  tone = "default",
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "warning" | "destructive";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 px-4 py-4",
        tone === "warning" && "bg-warning/5",
        tone === "destructive" && "bg-destructive/5",
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "size-5 text-muted-foreground",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
          )}
        />
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <div className="text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
      {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
