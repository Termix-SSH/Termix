/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { BackButton, PanelShell } from "@/components/panel-layout";
import {
  PROMPT_BUTTON,
  PROMPT_DESTRUCTIVE_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "./prompt-styles";

/**
 * A surface is a sidebar panel, a tab or a split pane. Inline views and
 * confirmations draw over the surface that asked, never over the whole app.
 */

export type EditingWidth = boolean | "wide";
export type SurfaceKind = "panel" | "tab" | "pane";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. Defaults to true, since most confirms delete. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ScopeValue {
  kind: SurfaceKind;
  overlay: HTMLElement | null;
  openView: (id: string, width: EditingWidth) => void;
  closeView: (id: string) => void;
  topView: string | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  close: (() => void) | null;
}

const ScopeContext = createContext<ScopeValue | null>(null);

function widest(widths: EditingWidth[]): EditingWidth {
  if (widths.includes("wide")) return "wide";
  return widths.some(Boolean);
}

// Only the most recently opened confirm, anywhere in the app, owns the keyboard.
const keyOwners: number[] = [];

export function SurfaceScope({
  kind = "panel",
  onEditingChange,
  onClose,
  className,
  children,
}: {
  kind?: SurfaceKind;
  /** Closes whatever this surface is, like the tab it fills. */
  onClose?: () => void;
  /** Gets the widest open inline view, so a sidebar can widen for it. */
  onEditingChange?: (editing: EditingWidth) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const [views, setViews] = useState<{ id: string; width: EditingWidth }[]>([]);
  const [confirms, setConfirms] = useState<PendingConfirm[]>([]);
  const nextConfirm = useRef(0);
  const editingRef = useRef(onEditingChange);
  editingRef.current = onEditingChange;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const hasClose = !!onClose;
  const close = useMemo(
    () => (hasClose ? () => closeRef.current?.() : null),
    [hasClose],
  );

  const openView = useCallback((id: string, width: EditingWidth) => {
    setViews((prev) => [...prev.filter((v) => v.id !== id), { id, width }]);
  }, []);
  const closeView = useCallback((id: string) => {
    setViews((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const editing = widest(views.map((v) => v.width));
  useEffect(() => {
    editingRef.current?.(editing);
  }, [editing]);
  useEffect(() => () => editingRef.current?.(false), []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const id = ++nextConfirm.current;
        setConfirms((prev) => [...prev, { ...options, id, resolve }]);
      }),
    [],
  );

  const settle = useCallback((id: number, ok: boolean) => {
    setConfirms((prev) => {
      prev.find((c) => c.id === id)?.resolve(ok);
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  // A scope that unmounts with a question open answers it with no.
  const confirmsRef = useRef(confirms);
  confirmsRef.current = confirms;
  useEffect(
    () => () => confirmsRef.current.forEach((c) => c.resolve(false)),
    [],
  );

  const value = useMemo<ScopeValue>(
    () => ({
      kind,
      overlay,
      openView,
      closeView,
      topView: views.length ? views[views.length - 1].id : null,
      confirm,
      close,
    }),
    [kind, overlay, openView, closeView, views, confirm, close],
  );

  const current = confirms[0];

  return (
    <ScopeContext.Provider value={value}>
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          className,
        )}
      >
        {children}
        <div
          ref={setOverlay}
          className={cn(
            "absolute inset-0 z-40 flex flex-col bg-background",
            views.length === 0 && "hidden",
          )}
        />
        {current && (
          <ConfirmCard
            key={current.id}
            options={current}
            onSettle={(ok) => settle(current.id, ok)}
          />
        )}
      </div>
    </ScopeContext.Provider>
  );
}

/** Which kind of surface this code renders in, or null outside any. */
export function useSurfaceKind(): SurfaceKind | null {
  return useContext(ScopeContext)?.kind ?? null;
}

/** Closes the surface this code renders in, or null when it can't be closed. */
export function useSurfaceClose(): (() => void) | null {
  return useContext(ScopeContext)?.close ?? null;
}

/**
 * Asks a yes or no question over the surface that called it. Enter confirms
 * and Esc cancels, before a terminal can see the key.
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const scope = useContext(ScopeContext);
  return useCallback(
    (options: ConfirmOptions) => {
      if (scope) return scope.confirm(options);
      const text = [options.title, options.description]
        .filter((part) => typeof part === "string")
        .join("\n\n");
      return Promise.resolve(window.confirm(text));
    },
    [scope],
  );
}

function ConfirmCard({
  options,
  onSettle,
}: {
  options: ConfirmOptions;
  onSettle: (ok: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const destructive = options.destructive ?? true;
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;

  useEffect(() => {
    const owner = Math.random();
    keyOwners.push(owner);
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (keyOwners[keyOwners.length - 1] !== owner) return;
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      settleRef.current(e.key === "Enter");
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      keyOwners.splice(keyOwners.indexOf(owner), 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <PanePrompt
      open
      role="alertdialog"
      labelledBy={titleId}
      title={options.title}
      titleId={titleId}
      description={options.description}
      tone={destructive ? "destructive" : "default"}
      onCancel={() => onSettle(false)}
      actions={
        <>
          <button
            type="button"
            onClick={() => onSettle(false)}
            className={PROMPT_BUTTON}
          >
            {options.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onSettle(true)}
            className={
              destructive ? PROMPT_DESTRUCTIVE_BUTTON : PROMPT_PRIMARY_BUTTON
            }
          >
            {options.confirmLabel ??
              (destructive ? t("common.delete") : t("common.confirm"))}
            <span aria-hidden className="ml-1.5 opacity-60">
              ↵
            </span>
          </button>
        </>
      }
    />
  );
}

/**
 * A small card over the surface it sits in. Confirmations use it, and so do
 * prompts that belong to a connection, like a sudo password.
 */
export function PanePrompt({
  open,
  title,
  titleId,
  description,
  icon,
  tone = "default",
  actions,
  onCancel,
  role = "dialog",
  labelledBy,
  layer = "pane",
  backgroundColor,
  className,
  children,
}: {
  open: boolean;
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "destructive";
  actions?: React.ReactNode;
  /** Clicking the dimmed backdrop. */
  onCancel?: () => void;
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
  /**
   * "connection" covers a connecting surface (a terminal waiting on a login)
   * with an opaque backdrop, above everything the surface draws.
   */
  layer?: "pane" | "connection";
  /** Backdrop color for the connection layer, usually the terminal theme. */
  backgroundColor?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const fallbackId = useId();
  if (!open) return null;
  const headingId = titleId ?? fallbackId;
  return (
    <div
      className={cn(
        "motion-fade-enter absolute inset-0 flex items-center justify-center overflow-y-auto p-4",
        layer === "connection" ? "z-500 bg-canvas" : "z-50 bg-background/85",
      )}
      style={
        layer === "connection" && backgroundColor
          ? { backgroundColor }
          : undefined
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? headingId}
        className={cn(
          "motion-context-enter my-auto flex w-full max-w-sm flex-col border bg-popover shadow-xl",
          tone === "destructive" ? "border-destructive/40" : "border-border",
          className,
        )}
      >
        <div className="flex items-start gap-2.5 px-4 pt-4">
          {icon && (
            <span
              className={cn(
                "mt-0.5 shrink-0",
                tone === "destructive"
                  ? "text-destructive"
                  : "text-accent-brand",
              )}
            >
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p
              id={headingId}
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              {title}
            </p>
            {description && (
              <div className="text-xs leading-snug text-muted-foreground">
                {description}
              </div>
            )}
          </div>
        </div>
        {children && <div className="px-4 pt-3">{children}</div>}
        {actions && (
          <div className="flex justify-end gap-2 px-4 py-3">{actions}</div>
        )}
        {!actions && <div className="h-4" />}
      </div>
    </div>
  );
}

/**
 * What used to be a modal: a view that takes over the surface it was opened
 * from, with a Back button. Opened from a sidebar it widens the sidebar.
 */
export function InlineView({
  open,
  onOpenChange,
  title,
  icon,
  status,
  actions,
  toolbar,
  footer,
  width = true,
  onBeforeClose,
  scroll = true,
  bare = false,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Pinned under the body, usually Cancel and Save. */
  footer?: React.ReactNode;
  /** How far a sidebar widens while this is open. */
  width?: EditingWidth;
  /** Return false to stay open, for an unsaved changes guard. */
  onBeforeClose?: () => boolean | Promise<boolean>;
  scroll?: boolean;
  /** Draw children edge to edge, for views with their own bands. */
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const scope = useContext(ScopeContext);
  const id = useId();
  const { openView, closeView } = scope ?? {};

  useLayoutEffect(() => {
    if (!open || !openView || !closeView) return;
    openView(id, width);
    return () => closeView(id);
  }, [open, id, width, openView, closeView]);

  const requestClose = useCallback(async () => {
    if (onBeforeClose && !(await onBeforeClose())) return;
    onOpenChange(false);
  }, [onBeforeClose, onOpenChange]);

  if (!open) return null;

  const padded = scope?.kind === "tab" || scope?.kind === "pane";
  const view = (
    <div
      className={cn(
        "absolute inset-0 flex flex-col",
        scope && scope.topView !== id && "hidden",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          void requestClose();
        }
      }}
    >
      <PanelShell
        leading={<BackButton onClick={() => void requestClose()} />}
        icon={icon}
        title={title}
        status={status}
        actions={actions}
        toolbar={toolbar}
        footer={footer}
        scroll={scroll}
      >
        {bare ? (
          children
        ) : (
          <div
            className={cn(
              "flex w-full flex-col gap-3",
              padded ? "mx-auto max-w-3xl p-3" : "p-3",
              !scroll && "min-h-0 flex-1",
              className,
            )}
          >
            {children}
          </div>
        )}
      </PanelShell>
    </div>
  );

  if (scope?.overlay) return createPortal(view, scope.overlay);
  if (scope) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-background">{view}</div>,
    document.body,
  );
}
