import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  Check,
  ExternalLink,
  Filter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { HostManager } from "@/sidebar/HostManager";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";

export type CredentialSortKey =
  | "default"
  | "name-asc"
  | "name-desc"
  | "username-asc"
  | "username-desc";

export type CredentialFilterState = {
  type: ("password" | "key")[];
  tags: string[];
};

const DEFAULT_FILTERS: CredentialFilterState = { type: [], tags: [] };

export function CredentialsPanel({
  onEditingChange,
  active = true,
}: {
  onEditingChange?: (editing: boolean) => void;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [managerEditing, setManagerEditing] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<CredentialSortKey>(
    () =>
      (localStorage.getItem("credentialSortKey") as CredentialSortKey) ??
      "default",
  );
  const [filterState, setFilterState] = useState<CredentialFilterState>(() => {
    try {
      const saved = localStorage.getItem("credentialFilterState");
      return saved
        ? (JSON.parse(saved) as CredentialFilterState)
        : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const filterActive = Object.values(filterState).some((arr) => arr.length > 0);

  function handleSortChange(key: CredentialSortKey) {
    setSortKey(key);
    localStorage.setItem("credentialSortKey", key);
  }

  function handleFilterToggle<K extends keyof CredentialFilterState>(
    group: K,
    value: CredentialFilterState[K][number],
  ) {
    setFilterState((prev) => {
      const arr = prev[group] as string[];
      const next = arr.includes(value as string)
        ? arr.filter((v) => v !== value)
        : [...arr, value as string];
      const updated = { ...prev, [group]: next };
      localStorage.setItem("credentialFilterState", JSON.stringify(updated));
      return updated as CredentialFilterState;
    });
  }

  function handleFilterClear() {
    setFilterState(DEFAULT_FILTERS);
    localStorage.setItem(
      "credentialFilterState",
      JSON.stringify(DEFAULT_FILTERS),
    );
  }

  function handleEditingChange(editing: boolean) {
    setManagerEditing(editing);
    onEditingChange?.(editing);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {!managerEditing && (
        <div className="flex flex-col px-2 py-1.5 shrink-0 border-b border-border/60 gap-1.5">
          <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60 rounded-sm">
            <Search className="size-3 text-muted-foreground/60 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("credentials.searchCredentials")}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`size-7 ${sortKey !== "default" ? "text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
                  title={t("credentials.sortCredentials")}
                >
                  <ArrowUpDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="text-xs min-w-[160px]"
              >
                <DropdownMenuItem
                  onClick={() => handleSortChange("default")}
                  className="flex items-center gap-1.5"
                >
                  {sortKey === "default" ? (
                    <Check className="size-3 shrink-0 text-accent-brand" />
                  ) : (
                    <span className="size-3 shrink-0 inline-block" />
                  )}
                  {t("credentials.sortDefault")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {(["name-asc", "name-desc"] as const).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => handleSortChange(key)}
                    className="flex items-center gap-1.5"
                  >
                    {sortKey === key ? (
                      <Check className="size-3 shrink-0 text-accent-brand" />
                    ) : (
                      <span className="size-3 shrink-0 inline-block" />
                    )}
                    {t(
                      `credentials.sort${key === "name-asc" ? "NameAsc" : "NameDesc"}`,
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {(["username-asc", "username-desc"] as const).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => handleSortChange(key)}
                    className="flex items-center gap-1.5"
                  >
                    {sortKey === key ? (
                      <Check className="size-3 shrink-0 text-accent-brand" />
                    ) : (
                      <span className="size-3 shrink-0 inline-block" />
                    )}
                    {t(
                      `credentials.sort${key === "username-asc" ? "UsernameAsc" : "UsernameDesc"}`,
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`size-7 ${filterActive ? "text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
                  title={t("credentials.filterCredentials")}
                >
                  <Filter className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="text-xs min-w-[180px]"
              >
                {filterActive && (
                  <>
                    <DropdownMenuItem
                      onClick={handleFilterClear}
                      className="flex items-center gap-1.5 text-accent-brand"
                    >
                      <X className="size-3 shrink-0" />
                      {t("credentials.filterClearAll")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel>
                  {t("credentials.filterTypeGroup")}
                </DropdownMenuLabel>
                {(["password", "key"] as const).map((val) => (
                  <DropdownMenuCheckboxItem
                    key={val}
                    checked={filterState.type.includes(val)}
                    onCheckedChange={() => handleFilterToggle("type", val)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t(
                      `credentials.filterType${val.charAt(0).toUpperCase() + val.slice(1)}`,
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
                {allTags.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      {t("credentials.filterTagsGroup")}
                    </DropdownMenuLabel>
                    {allTags.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag}
                        checked={filterState.tags.includes(tag)}
                        onCheckedChange={() => handleFilterToggle("tags", tag)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {tag}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <a
              href="https://docs.termix.site/features/files-and-hosts/credentials"
              target="_blank"
              rel="noreferrer"
              title={t("hosts.docsLink")}
              className="flex items-center justify-center size-7 text-muted-foreground hover:text-foreground shrink-0 transition-colors ml-auto"
            >
              <ExternalLink className="size-3.5" />
            </a>
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("host-manager:add-credential"),
                )
              }
              title={t("credentials.addCredential")}
              className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 border border-accent-brand/30 rounded-sm shrink-0 transition-colors"
            >
              <Plus className="size-3 shrink-0" />
              {t("credentials.addCredential")}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        <HostManager
          hideListHeader
          externalSearch={managerEditing ? undefined : search}
          externalSort={sortKey}
          externalFilter={filterState}
          onTagsChange={setAllTags}
          onEditingChange={handleEditingChange}
          active={active}
        />
      </div>
    </div>
  );
}
