import { useState } from "react";
import type React from "react";

export function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex-1">
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
  children,
}: {
  label: string;
  badge?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{label}</span>
          {badge && (
            <span className="text-[10px] font-bold text-yellow-500 border border-yellow-500/40 px-1">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="shrink-0 ml-4 md:ml-8">{children}</div>
    </div>
  );
}

export function FakeSwitch({
  defaultChecked = false,
  checked,
  onChange,
}: {
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [internalOn, setInternalOn] = useState(defaultChecked);
  const on = checked !== undefined ? checked : internalOn;
  return (
    <button
      onClick={() => {
        const next = !on;
        if (checked === undefined) setInternalOn(next);
        onChange?.(next);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${on ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
    >
      <span
        className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}
