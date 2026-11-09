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
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      {icon && (
        <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3">
          {icon}
        </span>
      )}
      <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
