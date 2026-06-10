import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import { FolderIconEl } from "@/components/folder-style";

const SEP = " / ";

export function splitPath(path: string): string[] {
  return path
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function normalizePath(path: string): string {
  return splitPath(path).join(SEP);
}

export function FolderPathPicker({
  value,
  onChange,
  folderPaths,
  folderMeta,
}: {
  value: string;
  onChange: (path: string) => void;
  folderPaths: string[];
  folderMeta?: Map<string, { color?: string; icon?: string }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allPaths = useMemo(
    () =>
      [...new Set(folderPaths.filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [folderPaths],
  );

  const query = search.trim();
  const normalizedQuery = normalizePath(query);
  const normalizedQueryLower = normalizedQuery.toLowerCase();
  const filtered = query
    ? allPaths.filter((p) => {
        const lower = p.toLowerCase();
        return (
          lower.includes(query.toLowerCase()) ||
          lower.includes(normalizedQueryLower)
        );
      })
    : allPaths;

  const canCreate =
    normalizedQuery.length > 0 &&
    !allPaths.some((p) => p.toLowerCase() === normalizedQuery.toLowerCase());

  function commit(path: string) {
    onChange(normalizePath(path));
    setSearch("");
    setOpen(false);
  }

  const segments = value ? splitPath(value) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 text-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 outline-none"
        >
          {segments.length > 0 ? (
            <span className="flex items-center gap-1 min-w-0 flex-1">
              <FolderIconEl
                icon={folderMeta?.get(value)?.icon ?? "folder"}
                className="size-3.5 shrink-0"
                style={{ color: folderMeta?.get(value)?.color }}
              />
              <span className="flex items-center min-w-0 truncate">
                {segments.map((seg, i) => (
                  <span key={i} className="flex items-center min-w-0">
                    {i > 0 && (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                    )}
                    <span className="truncate">{seg}</span>
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span className="flex-1 text-left text-muted-foreground">
              {t("hosts.folderPickerPlaceholder")}
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
        className="w-max min-w-(--radix-popover-trigger-width) max-w-72 max-h-(--radix-popover-content-available-height) p-0 rounded-none border-0 ring-1 ring-border shadow-md flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-border px-2.5 h-8 shrink-0">
          <Search className="size-3 shrink-0 text-muted-foreground/60" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canCreate) commit(normalizedQuery);
                else if (filtered.length > 0) commit(filtered[0]);
              }
            }}
            placeholder={t("hosts.folderPickerSearch")}
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
              {t("hosts.folderPickerNone")}
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => commit(normalizedQuery)}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-accent-brand hover:bg-accent transition-colors"
            >
              <FolderPlus className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("hosts.folderPickerCreate", { path: normalizedQuery })}
              </span>
            </button>
          )}
          {filtered.map((p) => {
            const meta = folderMeta?.get(p);
            const parts = splitPath(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => commit(p)}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors ${
                  p === value
                    ? "bg-accent/60 text-foreground"
                    : "text-foreground/80"
                }`}
              >
                <FolderIconEl
                  icon={meta?.icon ?? "folder"}
                  className="size-3.5 shrink-0"
                  style={{ color: meta?.color }}
                />
                <span className="flex items-center min-w-0 truncate">
                  {parts.map((seg, i) => (
                    <span key={i} className="flex items-center min-w-0">
                      {i > 0 && (
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                      )}
                      <span className="truncate">{seg}</span>
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && !canCreate && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {t("hosts.folderPickerEmpty")}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
