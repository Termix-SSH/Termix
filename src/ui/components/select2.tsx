import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import { cn } from "@/lib/utils";

type Select2Option = {
  value: string;
  label: string;
  disabled: boolean;
  hidden: boolean;
  group?: string;
};

type Select2Props = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
> & {
  placeholder?: string;
};

function getText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return getText(child.props.children);
      }
      return "";
    })
    .join("")
    .trim();
}

function getOptions(
  children: React.ReactNode,
  group?: string,
): Select2Option[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];

    if (child.type === "optgroup") {
      const props =
        child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      return getOptions(props.children, props.label);
    }

    if (child.type !== "option") return [];

    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = props.label ?? getText(props.children);
    return [
      {
        value: String(props.value ?? label),
        label,
        disabled: Boolean(props.disabled),
        hidden: Boolean(props.hidden),
        group,
      },
    ];
  });
}

function createSelectChangeEvent(
  value: string,
  name: string | undefined,
): React.ChangeEvent<HTMLSelectElement> {
  return {
    target: { value, name },
    currentTarget: { value, name },
  } as React.ChangeEvent<HTMLSelectElement>;
}

function Select2({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  placeholder,
  name,
  id,
  required,
  "aria-label": ariaLabel,
  ...props
}: Select2Props) {
  const options = React.useMemo(() => getOptions(children), [children]);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    String(defaultValue ?? ""),
  );

  const currentValue =
    value === undefined ? uncontrolledValue : String(value ?? "");
  const selected = options.find((option) => option.value === currentValue);
  const visibleOptions = options.filter((option) => !option.hidden);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = visibleOptions.filter((option) => {
    if (!normalizedQuery) return true;
    return (
      option.label.toLowerCase().includes(normalizedQuery) ||
      option.value.toLowerCase().includes(normalizedQuery) ||
      option.group?.toLowerCase().includes(normalizedQuery)
    );
  });

  const selectValue = (nextValue: string) => {
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.(createSelectChangeEvent(nextValue, name));
    setOpen(false);
    setQuery("");
  };

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <select
        name={name}
        value={currentValue}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => selectValue(event.target.value)}
      >
        {children}
      </select>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-required={required}
          className={cn(
            "border-input bg-background text-foreground flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          {...props}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !selected && "text-muted-foreground",
            )}
          >
            {selected?.label || placeholder || "Select an option"}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[99999] w-[var(--radix-popover-trigger-width)] min-w-52 p-0"
      >
        <div className="flex items-center border-b border-border px-2">
          <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div
          role="listbox"
          className="max-h-64 overflow-y-auto p-1 thin-scrollbar"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filteredOptions.map((option, index) => {
              const showGroup =
                option.group &&
                filteredOptions
                  .slice(0, index)
                  .every((previous) => previous.group !== option.group);
              const isSelected = option.value === currentValue;
              return (
                <React.Fragment key={`${option.group ?? ""}:${option.value}`}>
                  {showGroup && (
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {option.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                      isSelected && "bg-muted text-accent-foreground",
                    )}
                    onClick={() => selectValue(option.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {isSelected && <Check className="size-4 shrink-0" />}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { Select2 };
