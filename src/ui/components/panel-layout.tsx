/* eslint-disable react-refresh/only-export-components */
import { Children, Fragment, isValidElement, useRef } from "react";
import type React from "react";
import { ArrowLeft, Grid3X3, List, Rows3, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/separator";
import { DocsLink } from "@/components/docs-link";

/** One spacing rhythm for every panel and tab. */
export const PANEL = {
  body: "p-2.5",
  gap: "gap-2",
  band: "px-3 py-2",
  cardHead: "px-3 py-2.5",
  header: "h-12.5",
} as const;

export type PanelViewMode = "grid" | "list";
export type PanelDensity = "comfortable" | "compact";

/** The header, toolbar band and body every tab and panel draws. */
export function PanelShell({
  chrome = true,
  icon,
  title,
  status,
  leading,
  actions,
  toolbar,
  tabs,
  footer,
  scroll = true,
  docs,
  className,
  children,
}: {
  /** False inside a sidebar, which draws its own header. */
  chrome?: boolean;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  /** Short caption beside the title, like "12 of 18 running". */
  status?: React.ReactNode;
  /** Sits before the title, usually a BackButton. */
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** A full-bleed tab strip in place of a toolbar. */
  tabs?: React.ReactNode;
  /** A bar pinned under the body, like Cancel and Save. */
  footer?: React.ReactNode;
  /** False when the body scrolls itself. */
  scroll?: boolean;
  /** Docs URL for this screen, shown as a book icon in the header. */
  docs?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const body = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        scroll && "overflow-y-auto thin-scrollbar",
        className,
      )}
    >
      {children}
    </div>
  );

  const bands = (
    <>
      {toolbar && (
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-border ${PANEL.band}`}
        >
          {toolbar}
        </div>
      )}
      {tabs && (
        <div className="shrink-0 border-b border-border px-1">{tabs}</div>
      )}
    </>
  );

  const foot = footer && (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
      {footer}
    </div>
  );

  if (!chrome) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {bands}
        {body}
        {foot}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        className={`flex ${PANEL.header} shrink-0 flex-row items-center border-b border-border`}
      >
        {leading && (
          <div className="flex h-full shrink-0 border-r border-border">
            {leading}
          </div>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
          {icon && <span className="shrink-0 text-accent-brand">{icon}</span>}
          <span className="truncate text-base font-bold tracking-tight">
            {title}
          </span>
          {status && (
            <>
              <Separator
                orientation="vertical"
                className="h-4 data-[orientation=vertical]:self-center"
              />
              <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {status}
              </span>
            </>
          )}
        </div>
        {(actions || docs) && (
          <div className="flex shrink-0 items-center gap-1 px-2">
            {actions}
            {docs && <DocsLink href={docs} variant="icon" />}
          </div>
        )}
      </header>
      {bands}
      {body}
      {foot}
    </div>
  );
}

/** Square back button sized for the PanelShell header. */
export function BackButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t("common.back");
  return (
    <button
      type="button"
      onClick={onClick}
      title={text}
      aria-label={text}
      className={cn(
        "flex h-full w-12.5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}

/** Search box sized to match toolbar buttons. Esc clears it. */
export function PanelSearch({
  value,
  onChange,
  placeholder,
  fill,
  autoFocus,
  disabled,
  title,
  onEnter,
  inputRef,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Takes the whole toolbar, for panels where search is the only control. */
  fill?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  title?: string;
  /** Runs on Enter, for searches that query a server. */
  onEnter?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}) {
  const { t } = useTranslation();
  const localRef = useRef<HTMLInputElement>(null);
  const text = placeholder ?? t("common.search");
  return (
    <div
      className={cn(
        "relative",
        fill ? "w-full min-w-0 flex-1" : "w-40 md:w-56",
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={(el) => {
          localRef.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef)
            (
              inputRef as React.MutableRefObject<HTMLInputElement | null>
            ).current = el;
        }}
        type="text"
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        title={title}
        aria-label={text}
        placeholder={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="h-8 w-full min-w-0 border border-input bg-transparent pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      />
      {value && (
        <button
          type="button"
          aria-label={t("panel.clearSearch")}
          title={t("panel.clearSearch")}
          onClick={() => {
            onChange("");
            localRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Square segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly {
    value: NoInfer<T>;
    label: string;
    icon?: React.ReactNode;
    count?: number;
    title?: string;
  }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn("flex items-center border border-border", className)}
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center justify-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring",
              i > 0 && "border-l border-border",
              active
                ? "bg-accent-brand/10 text-accent-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined && (
              <span className="text-[10px] tabular-nums opacity-60">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Grid or list, plus the compact rows toggle. */
export function ViewToggle({
  view,
  onView,
  density,
  onDensity,
}: {
  view: PanelViewMode;
  onView: (next: PanelViewMode) => void;
  density?: PanelDensity;
  onDensity?: (next: PanelDensity) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center border border-border">
      <ToggleButton
        active={view === "grid"}
        onClick={() => onView("grid")}
        title={t("panel.gridView")}
      >
        <Grid3X3 className="size-4" />
      </ToggleButton>
      <ToggleButton
        active={view === "list"}
        onClick={() => onView("list")}
        title={t("panel.listView")}
        bordered
      >
        <List className="size-4" />
      </ToggleButton>
      {density && onDensity && (
        <ToggleButton
          active={density === "compact"}
          onClick={() =>
            onDensity(density === "compact" ? "comfortable" : "compact")
          }
          title={
            density === "compact"
              ? t("panel.comfortableRows")
              : t("panel.compactRows")
          }
          bordered
        >
          <Rows3 className="size-4" />
        </ToggleButton>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  bordered,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex size-8 items-center justify-center transition-colors focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring",
        bordered && "border-l border-border",
        active
          ? "bg-accent-brand/10 text-accent-brand"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A run of peer facts with a rule between each pair, like "12 online | 40
 * hosts". Never wraps; a fact that does not fit is truncated.
 */
/** Children with fragments opened up, so each fact gets its own divider. */
function flattenFacts(children: React.ReactNode): React.ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: React.ReactNode }>(child) &&
    child.type === Fragment
      ? flattenFacts(child.props.children)
      : [child],
  );
}

export function Facts({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const items = flattenFacts(children);
  if (items.length === 0) return null;

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
          )}
          <span className="min-w-0 truncate">{child}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Section label with a rule running to the edge. */
export function GroupHeading({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      {count !== undefined && (
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-border" />
      {action}
    </div>
  );
}
