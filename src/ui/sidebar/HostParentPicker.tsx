import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, Search, Server, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import type { Host } from "@/types/ui-types";

/**
 * Walks parentHostId to collect every descendant id of `hostId`, so a host
 * can never be assigned under its own descendant (which would form a cycle).
 * Mirrors the ancestor-walk cycle guard used server-side and in buildHostTree.
 */
export function collectDescendantIds(
  hostId: string,
  hosts: Host[],
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const h of hosts) {
    if (!h.parentHostId) continue;
    const list = childrenByParent.get(h.parentHostId) ?? [];
    list.push(h.id);
    childrenByParent.set(h.parentHostId, list);
  }

  const out = new Set<string>();
  const stack = [...(childrenByParent.get(hostId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return out;
}

export function HostParentPicker({
  value,
  onChange,
  hosts,
  excludeHostId,
}: {
  value: string;
  onChange: (hostId: string) => void;
  hosts: Host[];
  /** The host being edited, if any -- excluded from the list along with its descendants. */
  excludeHostId?: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const excludedIds = useMemo(() => {
    if (!excludeHostId) return new Set<string>();
    const descendants = collectDescendantIds(excludeHostId, hosts);
    descendants.add(excludeHostId);
    return descendants;
  }, [excludeHostId, hosts]);

  const candidates = useMemo(
    () =>
      hosts
        .filter((h) => !excludedIds.has(h.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [hosts, excludedIds],
  );

  const query = search.trim().toLowerCase();
  const filtered = query
    ? candidates.filter(
        (h) =>
          h.name.toLowerCase().includes(query) ||
          h.ip.toLowerCase().includes(query),
      )
    : candidates;

  const selected = value ? hosts.find((h) => h.id === value) : undefined;

  function commit(hostId: string) {
    onChange(hostId);
    setSearch("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 text-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 outline-none"
        >
          {selected ? (
            <span className="flex items-center gap-1.5 min-w-0 flex-1">
              <Server className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate">{selected.name || selected.ip}</span>
            </span>
          ) : (
            <span className="flex-1 text-left text-muted-foreground">
              {t("hosts.parentHostPickerPlaceholder")}
            </span>
          )}
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </span>
          )}
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="w-max min-w-(--radix-popover-trigger-width) max-w-96 max-h-(--radix-popover-content-available-height) p-0 rounded-none border-0 ring-1 ring-border shadow-md flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-border px-2.5 h-8 shrink-0">
          <Search className="size-3 shrink-0 text-muted-foreground/60" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                commit(filtered[0].id);
              }
            }}
            placeholder={t("hosts.parentHostPickerSearch")}
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {value && (
            <button
              type="button"
              onClick={() => commit("")}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <X className="size-3.5 shrink-0" />
              {t("hosts.parentHostPickerNone")}
            </button>
          )}
          {filtered.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => commit(h.id)}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors ${
                h.id === value
                  ? "bg-accent/60 text-foreground"
                  : "text-foreground/80"
              }`}
            >
              <Server className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate flex-1 min-w-0">{h.name || h.ip}</span>
              <span className="text-[10px] text-muted-foreground/50 truncate shrink-0">
                {h.ip}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {t("hosts.parentHostPickerEmpty")}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
