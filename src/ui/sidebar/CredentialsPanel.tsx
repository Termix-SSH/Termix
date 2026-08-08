import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  Check,
  ExternalLink,
  Filter,
  GripVertical,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { HostManager } from "@/sidebar/HostManager";
import { useCredentialSidebarPreferences } from "@/sidebar/credential-tree/hooks/useCredentialSidebarPreferences";
import { CustomizeCredentialsSidebarPanel } from "@/sidebar/CustomizeCredentialsSidebarPanel";
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
import type { CredentialSortKey } from "@/types/credential-sidebar-preferences";

export function CredentialsPanel({
  onEditingChange,
  active = true,
}: {
  onEditingChange?: (editing: boolean) => void;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const { preferences: sidebarPrefs, update: updateSidebarPrefs } =
    useCredentialSidebarPreferences();
  const [search, setSearch] = useState("");
  const [managerEditing, setManagerEditing] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [customizePanelOpen, setCustomizePanelOpen] = useState(false);

  const sortKey = sidebarPrefs.sort.key;
  const filterState = sidebarPrefs.filters;
  const filterActive =
    filterState.type.length > 0 || filterState.tags.length > 0;

  function handleSortChange(key: CredentialSortKey) {
    updateSidebarPrefs((prev) => ({
      ...prev,
      sort: { ...prev.sort, key },
    }));
  }

  function handleFilterToggle<K extends keyof typeof filterState>(
    group: K,
    value: (typeof filterState)[K][number],
  ) {
    updateSidebarPrefs((prev) => {
      const arr = prev.filters[group] as string[];
      const next = arr.includes(value as string)
        ? arr.filter((v) => v !== value)
        : [...arr, value as string];
      return {
        ...prev,
        filters: { ...prev.filters, [group]: next },
      };
    });
  }

  function handleFilterClear() {
    updateSidebarPrefs((prev) => ({
      ...prev,
      filters: { type: [], tags: [] },
    }));
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

          <div className="flex items-center gap-1.5 overflow-x-auto overflow-y-hidden toolbar-scrollbar">
            <div className="flex items-center border border-border shrink-0">
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleSortChange("manual")}
                    className="flex items-center gap-1.5"
                  >
                    {sortKey === "manual" ? (
                      <Check className="size-3 shrink-0 text-accent-brand" />
                    ) : (
                      <GripVertical className="size-3 shrink-0 text-muted-foreground/40" />
                    )}
                    {t("credentials.sortManual")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px self-stretch bg-border" />
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
                          onCheckedChange={() =>
                            handleFilterToggle("tags", tag)
                          }
                          onSelect={(e) => e.preventDefault()}
                        >
                          {tag}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px self-stretch bg-border" />
              <a
                href="https://docs.termix.site/features/files-and-hosts/credentials"
                target="_blank"
                rel="noreferrer"
                title={t("hosts.docsLink")}
                className="flex items-center justify-center size-7 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
            <div className="flex items-center border border-border shrink-0">
              <button
                onClick={() => setCustomizePanelOpen(true)}
                title={t("credentials.customizeSidebar")}
                className="flex items-center justify-center size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center border border-accent-brand/30 ml-auto shrink-0">
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("host-manager:add-credential"),
                  )
                }
                title={t("credentials.addCredential")}
                className="flex items-center justify-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 transition-colors"
              >
                <Plus className="size-3 shrink-0" />
                <span className="hidden min-[280px]:inline">
                  {t("credentials.addCredential")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        <HostManager
          hideListHeader
          externalSearch={managerEditing ? undefined : search}
          externalSort={sortKey}
          externalFilter={filterState}
          density={sidebarPrefs.display.density}
          trayTrigger={sidebarPrefs.display.trayTrigger}
          showTags={sidebarPrefs.display.showTags}
          onTagsChange={setAllTags}
          onEditingChange={handleEditingChange}
          active={active}
        />
      </div>

      <CustomizeCredentialsSidebarPanel
        open={customizePanelOpen}
        onOpenChange={setCustomizePanelOpen}
        preferences={sidebarPrefs}
        update={updateSidebarPrefs}
      />
    </div>
  );
}
