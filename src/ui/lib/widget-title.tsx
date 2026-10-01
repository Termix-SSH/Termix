import type { LucideIcon } from "lucide-react";

interface WidgetTitleProps {
  title: string | null | undefined;
  icon?: React.ReactElement<LucideIcon>;
  fallback?: string;
}

export function WidgetTitle({ title, icon, fallback }: WidgetTitleProps) {
  const label = title || fallback;
  if (!label) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50 shrink-0">
      {icon && <span className="text-accent-brand shrink-0">{icon}</span>}
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
        {label}
      </span>
    </div>
  );
}
