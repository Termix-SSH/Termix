import { DefaultsOnly, HostDefaultBadge } from "@/lib/host-defaults-context";
import { useState } from "react";
import type React from "react";

export function SectionCard({
  title,
  icon,
  action,
  children,
  className,
  rowId,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Lets settings search jump to this card. */
  rowId?: string;
}) {
  return (
    <div
      data-setting-row={rowId}
      className={`flex flex-col border border-border bg-card overflow-hidden ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">
          {title}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-3 md:px-4 py-1">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  badge,
  description,
  defaultKey,
  rowId,
  children,
}: {
  label: string;
  badge?: string;
  description?: React.ReactNode;
  /**
   * In the host editor, the host default this row edits: a plugin's own
   * field key, or "core.<key>". Shows where the value comes from.
   */
  defaultKey?: string;
  /** Lets settings search jump to this row. */
  rowId?: string;
  children: React.ReactNode;
}) {
  return (
    <DefaultsOnly settingKey={defaultKey ?? ""}>
      {/* In a gap-4 form stack the gap already spaces the row, so its own
          padding and divider would double up. */}
      <div
        data-setting-row={rowId ?? ""}
        className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-0 [.gap-4>&]:py-0 [.gap-4>&]:border-0"
      >
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium leading-snug">{label}</span>
            {badge && (
              <span className="text-[10px] font-bold text-warning border border-warning/40 px-1 shrink-0">
                {badge}
              </span>
            )}
            {defaultKey && <HostDefaultBadge settingKey={defaultKey} />}
          </div>
          {description && (
            <span className="text-xs text-muted-foreground leading-snug">
              {description}
            </span>
          )}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </DefaultsOnly>
  );
}

export function FakeSwitch({
  defaultChecked = false,
  disabled = false,
  checked,
  onChange,
}: {
  defaultChecked?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [internalOn, setInternalOn] = useState(defaultChecked);
  const on = checked !== undefined ? checked : internalOn;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => {
        const next = !on;
        if (checked === undefined) setInternalOn(next);
        onChange?.(next);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
    >
      <span
        className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}
