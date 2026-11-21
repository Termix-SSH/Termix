import type { CSSProperties, ReactNode } from "react";
import { icons } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataBar, DataStat, DataTone, DataValue } from "./data-value";

/**
 * "row": items side by side, each a small column (host rows). "stack": one
 * item per line across the full width (widgets, cards). "inline": label, bar
 * and value on one line (toolbars).
 */
export type DataLayout = "row" | "stack" | "inline";

const TEXT: Record<DataTone, string> = {
  default: "text-foreground",
  good: "text-green-500",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

const FILL: Record<DataTone, string> = {
  default: "bg-accent-brand",
  good: "bg-green-500",
  warn: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

const BADGE: Record<DataTone, string> = {
  default: "border-border text-foreground",
  good: "border-green-500/40 text-green-500 bg-green-500/10",
  warn: "border-warning/40 text-warning bg-warning/10",
  bad: "border-destructive/40 text-destructive bg-destructive/10",
  muted: "border-border text-muted-foreground",
};

/** A plugin's color, mixed with the theme so it reads on light and dark. */
function colorStyle(
  color: string | undefined,
  variant: "outline" | "filled" | "icon" | "text" = "outline",
): CSSProperties | undefined {
  if (!color) return undefined;
  if (variant === "filled") {
    return {
      backgroundColor: `color-mix(in oklab, ${color} 85%, var(--foreground))`,
      borderColor: "transparent",
      color: "var(--background)",
    };
  }
  const text = `color-mix(in oklab, ${color} 75%, var(--foreground))`;
  if (variant === "text" || variant === "icon") return { color: text };
  return {
    color: text,
    borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
  };
}

function ValueIcon({ name }: { name?: string }) {
  const Icon = name ? icons[name as keyof typeof icons] : undefined;
  return Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null;
}

/** Bars with no tone of their own warn from 70% and turn bad from 90%. */
function barTone(item: DataBar): DataTone {
  if (item.tone) return item.tone;
  if (item.value === null) return "muted";
  if (item.value >= 0.9) return "bad";
  if (item.value >= 0.7) return "warn";
  return "default";
}

function percent(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function Bar({ item, layout }: { item: DataBar; layout: DataLayout }) {
  const tone = barTone(item);
  const width = `${Math.round((item.value ?? 0) * 100)}%`;
  const valueText = tone === "default" ? "text-accent-brand" : TEXT[tone];
  if (layout === "inline") {
    return (
      <div className="flex items-center gap-1.5 px-1.5" data-data-bar>
        <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {item.label}
        </span>
        <div className="h-1.5 w-12 shrink-0 overflow-hidden bg-muted">
          {item.value !== null && (
            <div
              className={cn("h-full transition-all", FILL[tone])}
              style={{ width }}
            />
          )}
        </div>
        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {item.value === null ? "--" : percent(item.value)}
        </span>
      </div>
    );
  }
  if (layout === "stack") {
    return (
      <div className="flex flex-col gap-0.5" data-data-bar>
        <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="truncate">{item.label}</span>
          <span className="shrink-0 text-right">
            {item.value === null ? "N/A" : percent(item.value)}
            {item.detail && (
              <span className="ml-1 opacity-60">{item.detail}</span>
            )}
          </span>
        </div>
        <div className="h-1 overflow-hidden bg-muted">
          <div
            className={cn("h-full transition-all", FILL[tone])}
            style={{ width }}
          />
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-w-16 shrink-0 flex-col gap-0.5"
      title={item.detail}
      data-data-bar
    >
      <div className="flex items-center justify-between gap-1 whitespace-nowrap">
        <span className="text-[10px] text-muted-foreground">{item.label}</span>
        <span className={cn("text-[10px] font-bold", valueText)}>
          {percent(item.value)}
        </span>
      </div>
      <div className="h-0.5 w-full bg-muted">
        <div className={cn("h-full", FILL[tone])} style={{ width }} />
      </div>
    </div>
  );
}

function statText(item: DataStat): string {
  if (item.value === null || item.value === "") return "-";
  return item.unit ? `${item.value} ${item.unit}` : String(item.value);
}

function Stat({ item, layout }: { item: DataStat; layout: DataLayout }) {
  const tone = TEXT[item.tone ?? "default"];
  if (layout === "stack") {
    return (
      <div
        className="flex justify-between gap-2 text-[10px]"
        title={item.tooltip}
        data-data-stat
      >
        <span className="shrink-0 text-muted-foreground">{item.label}</span>
        <span className={cn("truncate text-right", tone)}>
          {statText(item)}
        </span>
      </div>
    );
  }
  if (layout === "inline") {
    return (
      <span
        className="flex items-center gap-1 px-1.5 text-[10px]"
        title={item.tooltip}
        data-data-stat
      >
        <span className="text-muted-foreground">{item.label}</span>
        <span className={cn("tabular-nums", tone)}>{statText(item)}</span>
      </span>
    );
  }
  return (
    <div
      className="flex min-w-16 max-w-28 shrink-0 flex-col gap-0.5"
      title={item.tooltip}
      data-data-stat
    >
      <span className="truncate text-[10px] text-muted-foreground">
        {item.label}
      </span>
      <span className={cn("truncate text-[10px] font-bold", tone)}>
        {statText(item)}
      </span>
    </div>
  );
}

function Clickable({
  actionId,
  onAction,
  className,
  title,
  style,
  children,
}: {
  actionId?: string;
  onAction?: (actionId: string) => void;
  className: string;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (actionId && onAction) {
    return (
      <button
        type="button"
        className={cn(className, "cursor-pointer hover:opacity-80")}
        title={title}
        style={style}
        onClick={(event) => {
          event.stopPropagation();
          onAction(actionId);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title} style={style}>
      {children}
    </span>
  );
}

function Part({
  value,
  layout,
  onAction,
}: {
  value: DataValue;
  layout: DataLayout;
  onAction?: (actionId: string) => void;
}) {
  switch (value.shape) {
    case "bars":
      return (
        <>
          {value.items.map((item, index) => (
            <Bar key={`${item.label}-${index}`} item={item} layout={layout} />
          ))}
        </>
      );
    case "stat":
      return (
        <>
          {value.items.map((item, index) => (
            <Stat key={`${item.label}-${index}`} item={item} layout={layout} />
          ))}
        </>
      );
    case "badge": {
      const variant = value.variant ?? "outline";
      const iconOnly = variant === "icon" && !!value.icon;
      return (
        <Clickable
          actionId={value.actionId}
          onAction={onAction}
          title={value.tooltip ?? (iconOnly ? value.label : undefined)}
          style={colorStyle(value.color, iconOnly ? "icon" : variant)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold",
            iconOnly ? "px-0.5" : "border px-1.5 py-0.5",
            !value.color &&
              (iconOnly
                ? TEXT[value.tone ?? "default"]
                : BADGE[value.tone ?? "default"]),
          )}
        >
          <ValueIcon name={value.icon} />
          {iconOnly ? (
            <span className="sr-only" data-data-badge={value.tone ?? "default"}>
              {value.label}
            </span>
          ) : (
            <span data-data-badge={value.tone ?? "default"}>{value.label}</span>
          )}
        </Clickable>
      );
    }
    case "dot":
      return (
        <span
          className={cn(
            "inline-block size-2 shrink-0 rounded-full",
            FILL[value.tone],
          )}
          title={value.label || undefined}
          aria-label={value.label || undefined}
          data-data-dot={value.tone}
        />
      );
    case "text":
      return (
        <Clickable
          actionId={value.actionId}
          onAction={onAction}
          title={value.tooltip}
          style={colorStyle(value.color, "text")}
          className={cn(
            "inline-flex min-w-0 items-center gap-1 truncate text-[10px]",
            !value.color && TEXT[value.tone ?? "muted"],
          )}
        >
          <ValueIcon name={value.icon} />
          <span className="truncate">{value.text}</span>
        </Clickable>
      );
  }
}

/**
 * Draws checked data values (see parseDataValue). The one renderer for data
 * slots, so every layout and plugin shows them the same way.
 */
export function DataValues({
  values,
  layout = "row",
  className,
  onAction,
}: {
  values: DataValue[] | null | undefined;
  layout?: DataLayout;
  className?: string;
  /** Runs a value's actionId. Without it, values are not clickable. */
  onAction?: (actionId: string) => void;
}) {
  if (!values || values.length === 0) return null;
  return (
    <div
      className={cn(
        layout === "stack"
          ? "flex flex-col gap-2"
          : layout === "inline"
            ? "flex items-center"
            : "flex shrink-0 items-center gap-3",
        className,
      )}
      data-data-view={layout}
    >
      {values.map((value, index) => (
        <Part
          key={`${value.shape}-${index}`}
          value={value}
          layout={layout}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
