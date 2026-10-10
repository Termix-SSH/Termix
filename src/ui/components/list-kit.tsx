import { useState } from "react";
import type React from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

export type ListRowTone =
  "brand" | "muted" | "success" | "warning" | "destructive" | "none";

const STRIPE: Record<ListRowTone, string> = {
  brand: "bg-accent-brand/60",
  muted: "bg-muted-foreground/30",
  success: "bg-green-500/70",
  warning: "bg-warning/70",
  destructive: "bg-destructive/70",
  none: "bg-transparent",
};

/** Scrolling list body. Rows sit flush, divided by their own borders. */
export function PanelList({
  empty,
  className,
  children,
}: {
  /** Shown instead of the rows when there are none. */
  empty?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const hasRows = Array.isArray(children)
    ? children.flat().some(Boolean)
    : Boolean(children);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto thin-scrollbar",
        className,
      )}
    >
      {hasRows ? children : empty}
    </div>
  );
}

/**
 * One row in a sidebar list, drawn like the host list: a coloured stripe on
 * the left, a name with an optional line under it, and a row of action
 * buttons that opens under it on hover.
 */
export function ListRow({
  title,
  icon,
  badges,
  meta,
  stripe = 0,
  tone = "brand",
  color,
  selected,
  active,
  dimmed,
  leading,
  trailing,
  actions,
  onClick,
  className,
  children,
  ...rest
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Small chips after the title. */
  badges?: React.ReactNode;
  /** Muted line under the title, like a description or Facts. */
  meta?: React.ReactNode;
  /** Position in the list, odd rows get the zebra tint. */
  stripe?: number;
  tone?: ListRowTone;
  /** A custom stripe colour, like a group's own colour. */
  color?: string;
  selected?: boolean;
  /** Keeps the tray open, like while its menu is showing. */
  active?: boolean;
  dimmed?: boolean;
  /** Sits between the stripe and the text, like a drag handle. */
  leading?: React.ReactNode;
  /** Always visible on the right, like a switch. */
  trailing?: React.ReactNode;
  /** Buttons under the row that open on hover, like the host list. */
  actions?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  /** Extra lines under the meta. */
  children?: React.ReactNode;
} & Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title" | "onClick" | "children"
>) {
  return (
    <div
      {...rest}
      role={onClick ? "button" : rest.role}
      tabIndex={onClick ? 0 : rest.tabIndex}
      onClick={onClick}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        if (!onClick || e.defaultPrevented || e.target !== e.currentTarget)
          return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      data-selected={selected || undefined}
      className={cn(
        "group/row relative flex items-stretch select-none border-b border-border/40 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        onClick && "cursor-pointer",
        selected
          ? "bg-accent-brand/10 hover:bg-accent-brand/15"
          : active
            ? "bg-muted/50"
            : stripe % 2 === 1 && "bg-muted/15",
        dimmed && "opacity-60",
        className,
      )}
    >
      <div
        className={cn(
          "w-[3px] shrink-0",
          selected ? "bg-accent-brand" : !color && STRIPE[tone],
        )}
        style={color && !selected ? { backgroundColor: color } : undefined}
      />
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-[3.5px] py-[7px] pl-[8.75px] pr-[7px]">
        <div className="flex min-w-0 items-center gap-1.5">
          {icon && (
            <span className="flex shrink-0 text-muted-foreground/60 [&_svg]:size-3">
              {icon}
            </span>
          )}
          <span className="truncate text-[13px] font-semibold leading-none tracking-tight text-foreground">
            {title}
          </span>
          {badges}
        </div>
        {meta && (
          <div className="min-w-0 truncate text-[11px] leading-tight text-muted-foreground/80">
            {meta}
          </div>
        )}
        {children}
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex-wrap items-center gap-[1.75px] border-t border-border/30 pt-[3.5px]",
              active
                ? "flex"
                : "hidden group-hover/row:flex group-focus-within/row:flex pointer-coarse:flex",
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center pr-2">{trailing}</div>
      )}
    </div>
  );
}

/** Square icon button for a ListRow tray. */
export function ListRowAction({
  label,
  tone = "default",
  className,
  children,
  ...rest
}: {
  label: string;
  tone?: "default" | "brand" | "destructive";
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    ref?: React.Ref<HTMLButtonElement>;
  }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={cn(
        "flex size-[22.75px] items-center justify-center transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
        tone === "brand"
          ? "text-accent-brand/80 hover:text-accent-brand"
          : tone === "destructive"
            ? "text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            : "text-muted-foreground/60 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Small uppercase chip for a ListRow's badges. */
export function ListBadge({
  tone = "muted",
  className,
  children,
}: {
  tone?: "muted" | "brand" | "warning" | "destructive" | "success";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 border px-1 py-px text-[9px] uppercase leading-none tracking-wider [&_svg]:size-2.5",
        tone === "brand" &&
          "border-accent-brand/30 bg-accent-brand/10 text-accent-brand",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "destructive" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "success" &&
          "border-green-500/30 bg-green-500/10 text-green-500",
        tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A collapsible group in a ListRow list, drawn like a host folder. */
export function ListRowFolder({
  name,
  icon,
  count,
  open,
  onToggle,
  stripe = 0,
  actions,
  dropActive,
  onDropItem,
  emptyText,
  className,
  children,
}: {
  name: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  open: boolean;
  onToggle: () => void;
  stripe?: number;
  /** Shown on hover, usually a DropdownMenu trigger. */
  actions?: React.ReactNode;
  /** True while something is being dragged that could drop in here. */
  dropActive?: boolean;
  onDropItem?: () => void;
  emptyText?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  const empty = count === 0;
  return (
    <div className={cn("border-b border-border/40", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        onDragOver={(e) => {
          if (!dropActive) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          if (!dropActive) return;
          e.preventDefault();
          setDragOver(false);
          onDropItem?.();
        }}
        className={cn(
          "group/folder flex w-full cursor-pointer select-none items-center gap-2 py-1.5 pl-2.5 pr-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          open ? "bg-muted/40" : "hover:bg-muted/30",
          stripe % 2 === 1 && !open && "bg-muted/[0.08]",
          dragOver &&
            dropActive &&
            "bg-accent-brand/10 ring-1 ring-inset ring-accent-brand",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
          )}
        />
        {icon && (
          <span
            className={cn(
              "flex shrink-0 [&_svg]:size-4",
              open ? "text-accent-brand" : "text-muted-foreground/70",
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold tracking-tight text-foreground">
          {name}
        </span>
        {count !== undefined && (
          <span className="shrink-0 bg-muted/70 px-1.5 py-[1px] text-[10px] tabular-nums text-muted-foreground/70">
            {count}
          </span>
        )}
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100 has-[[data-state=open]]:opacity-100"
          >
            {actions}
          </div>
        )}
      </div>
      {open && (
        <div className="ml-[27px] border-l border-t border-border/50 border-t-border/40 [&>*:last-child]:border-b-0">
          {empty && emptyText ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/60">
              {emptyText}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

/** The one "add" button, placed beside a panel's search box. */
export function AddButton({
  label,
  compact,
  className,
  ...rest
}: {
  label?: string;
  /** Icon only, for tight toolbars. */
  compact?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    ref?: React.Ref<HTMLButtonElement>;
  }) {
  const { t } = useTranslation();
  const text = label ?? t("common.new");
  return (
    <Button
      variant="outline"
      size={compact ? "icon" : "default"}
      title={text}
      aria-label={text}
      {...rest}
      className={cn(
        "shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10",
        className,
      )}
    >
      <Plus className="size-3.5" />
      {!compact && <span>{text}</span>}
    </Button>
  );
}

/** The one Save bar, for a PanelShell or InlineView footer. */
export function FormFooter({
  onCancel,
  onSave,
  saveLabel,
  cancelLabel,
  saving,
  dirty,
  status,
  disabled,
  onDelete,
  deleteLabel,
  extra,
  saveType = "button",
  form,
}: {
  onCancel?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  saving?: boolean;
  /** Shows the unsaved changes note. */
  dirty?: boolean;
  /** Replaces the unsaved note, like an error count. */
  status?: React.ReactNode;
  disabled?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
  /** More buttons, placed before Save. */
  extra?: React.ReactNode;
  saveType?: "button" | "submit";
  /** Id of the form a submit Save belongs to. */
  form?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={saving}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10"
        >
          <Trash2 />
          {deleteLabel ?? t("common.delete")}
        </Button>
      )}
      <div className="min-w-0 flex-1 truncate text-[11px]">
        {status ??
          (dirty && (
            <span className="text-warning">{t("common.unsavedChanges")}</span>
          ))}
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
      )}
      {extra}
      {(onSave || saveType === "submit") && (
        <Button
          type={saveType}
          form={form}
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={disabled || saving}
          className="border-accent-brand/40 px-6 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
        >
          {saving ? t("common.saving") : (saveLabel ?? t("common.save"))}
        </Button>
      )}
    </div>
  );
}
