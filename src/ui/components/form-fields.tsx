/* eslint-disable react-refresh/only-export-components */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/button";
import { SettingRow, FakeSwitch } from "@/components/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { cn } from "@/lib/utils";

/** Label + control + optional hint, the shape every field shares. */
export function Field({
  label,
  hint,
  error,
  aside,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-setting-row="" className={cn("flex flex-col gap-1.5", className)}>
      {(label || aside) && (
        <div className="flex items-center gap-2">
          <label
            htmlFor={htmlFor}
            className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            {label}
          </label>
          {aside && <span className="ml-auto">{aside}</span>}
        </div>
      )}
      {children}
      {error ? (
        <span className="text-[10px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  aside,
  disabled,
  mono,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode;
  disabled?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      aside={aside}
      className={className}
    >
      <Input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={!!error}
        className={mono ? "font-mono" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  min,
  max,
  disabled,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        placeholder={placeholder}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/** Values the server sends in place of a stored secret. */
export const SECRET_SENTINELS = [
  "existing_password",
  "existing_key",
  "existing_key_password",
  "existing_sudo_password",
  "existing_rdp_password",
  "existing_vnc_password",
  "existing_telnet_password",
];

export function isSecretSentinel(value: string): boolean {
  return SECRET_SENTINELS.includes(value);
}

export function SecretField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const saved = isSecretSentinel(value);
  return (
    <Field
      label={label}
      hint={saved ? t("fields.secretSaved") : hint}
      error={error}
      className={className}
    >
      <PasswordInput
        value={saved ? "" : value}
        placeholder={saved ? "••••••••" : placeholder}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** A Radix dropdown, so its list uses the theme tokens. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  disabled,
  className,
  placeholder,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  // Radix treats "" as no selection, so empty options get a stand-in value.
  const EMPTY = "__empty__";
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <Select
        value={value === ("" as T) ? EMPTY : value}
        disabled={disabled}
        onValueChange={(next) => onChange((next === EMPTY ? "" : next) as T)}
      >
        <SelectTrigger aria-invalid={!!error} className="h-8 w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value === "" ? EMPTY : option.value}
              className="text-xs"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
  error,
  aside,
  mono,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      aside={aside}
      className={className}
    >
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full resize-none border border-input bg-background px-3 py-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          mono && "font-mono text-[10px]",
        )}
      />
    </Field>
  );
}

/** A labelled switch. */
export function SwitchRow({
  label,
  description,
  badge,
  checked,
  onChange,
  disabled,
  defaultKey,
  rowId,
}: {
  label: string;
  description?: ReactNode;
  badge?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  defaultKey?: string;
  rowId?: string;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      badge={badge}
      defaultKey={defaultKey}
      rowId={rowId}
    >
      <FakeSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </SettingRow>
  );
}

/** A list of rows you add to and remove from. */
export function Repeater<T>({
  label,
  items,
  onChange,
  makeItem,
  empty,
  addLabel,
  hint,
  renderItem,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  makeItem: () => T;
  empty: string;
  addLabel: string;
  hint?: ReactNode;
  renderItem: (item: T, update: (next: T) => void, index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-auto"
          onClick={() => onChange([...items, makeItem()])}
        >
          <Plus className="mr-1 size-3" />
          {addLabel}
        </Button>
      </div>

      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}

      {items.length === 0 ? (
        <span className="border border-dashed border-border px-3 py-2 text-[10px] text-muted-foreground">
          {empty}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-start gap-2 border border-border bg-muted/10 p-2"
            >
              <div className="min-w-0 flex-1">
                {renderItem(
                  item,
                  (next) =>
                    onChange(items.map((x, i) => (i === index ? next : x))),
                  index,
                )}
              </div>
              <button
                type="button"
                title={t("common.remove")}
                aria-label={t("common.remove")}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chip input for tags. */
export function TagInput({
  tags,
  input,
  placeholder,
  onTagsChange,
  onInputChange,
}: {
  tags: string[];
  input: string;
  placeholder: string;
  onTagsChange: (tags: string[]) => void;
  onInputChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/30">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={t("common.remove")}
            onClick={() => onTagsChange(tags.filter((tg) => tg !== tag))}
            className="ml-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        className="min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        placeholder={tags.length === 0 ? placeholder : ""}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && input.trim()) {
            e.preventDefault();
            const tag = input.trim();
            if (!tags.includes(tag)) onTagsChange([...tags, tag]);
            onInputChange("");
          } else if (e.key === "Backspace" && !input && tags.length > 0) {
            onTagsChange(tags.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

/** Two fields side by side above md, stacked below. */
export function FieldPair({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  );
}

/** Reads a picked file's text, for keys and certificates. */
export function useFileText(onText: (text: string) => void) {
  const [reading, setReading] = useState(false);
  return {
    reading,
    onFile: async (file: File | null | undefined) => {
      if (!file) return;
      setReading(true);
      try {
        onText((await file.text()).trim());
      } finally {
        setReading(false);
      }
    },
  };
}
