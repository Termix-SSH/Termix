import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TileKind =
  "card" | "signal" | "action" | "session" | "resource" | "chart";

export interface TilePickerEntry {
  /** Tile id the grid gets when this entry is added. */
  id: string;
  title: string;
  description?: string;
  /** Group heading, usually the plugin name. */
  group: string;
  kind: TileKind;
  icon?: ReactNode;
  /** Already on the grid; shown checked and not added twice. */
  placed?: boolean;
}

const KINDS: TileKind[] = [
  "card",
  "chart",
  "signal",
  "action",
  "resource",
  "session",
];
const KIND_LABELS: Record<TileKind | "all", string> = {
  all: "tileGrid.kind.all",
  card: "tileGrid.kind.card",
  chart: "tileGrid.kind.chart",
  signal: "tileGrid.kind.signal",
  action: "tileGrid.kind.action",
  resource: "tileGrid.kind.resource",
  session: "tileGrid.kind.session",
};

/**
 * Everything that can go on a grid, in a narrow column beside it while
 * editing. Search, filter by kind and fold groups, so long lists from many
 * plugins stay usable.
 */
export function TilePicker({
  entries,
  onAdd,
  onClose,
  className,
}: {
  entries: TilePickerEntry[];
  onAdd: (entry: TilePickerEntry) => void;
  onClose?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TileKind | null>(null);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());

  const kinds = useMemo(
    () => KINDS.filter((k) => entries.some((entry) => entry.kind === k)),
    [entries],
  );
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = entries.filter(
      (entry) =>
        (!kind || entry.kind === kind) &&
        (!needle ||
          entry.title.toLowerCase().includes(needle) ||
          entry.group.toLowerCase().includes(needle) ||
          entry.description?.toLowerCase().includes(needle)),
    );
    const map = new Map<string, TilePickerEntry[]>();
    for (const entry of shown) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries, query, kind]);
  const searching = query.trim().length > 0;

  const toggle = (group: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <div
      className={cn(
        "flex h-full w-72 shrink-0 flex-col border-l border-border bg-surface/40",
        className,
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <Plus className="size-3 text-accent-brand" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("tileGrid.addTiles")}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title={t("tileGrid.closePicker")}
            aria-label={t("tileGrid.closePicker")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
        <label className="flex h-7 items-center gap-1.5 border border-border bg-background px-2">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tileGrid.search")}
            aria-label={t("tileGrid.search")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {[null, ...kinds].map((k) => (
              <button
                key={k ?? "all"}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "h-5 border px-1.5 text-[10px] transition-colors",
                  kind === k
                    ? "border-accent-brand text-accent-brand"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t(KIND_LABELS[k ?? "all"])}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {groups.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {t("tileGrid.noMatches")}
          </p>
        )}
        {groups.map(([group, list]) => {
          const open = searching || !folded.has(group);
          return (
            <div key={group} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggle(group)}
                aria-expanded={open}
                className="flex h-7 w-full items-center gap-1.5 px-2 text-left hover:bg-hover"
              >
                {open ? (
                  <ChevronDown className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {group}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  {list.length}
                </span>
              </button>
              {open && (
                <ul className="pb-1">
                  {list.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={entry.placed}
                        onClick={() => onAdd(entry)}
                        title={entry.description}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3">
                          {entry.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{entry.title}</span>
                          {entry.description && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {entry.description}
                            </span>
                          )}
                        </span>
                        {entry.placed ? (
                          <Check className="size-3 shrink-0 text-accent-brand" />
                        ) : (
                          <Plus className="size-3 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
