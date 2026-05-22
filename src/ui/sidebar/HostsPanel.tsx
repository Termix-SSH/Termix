import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Plus, Search, X } from "lucide-react";
import { SidebarTree } from "@/sidebar/SidebarTree";
import { HostManager } from "@/sidebar/HostManager";
import type { Host, HostFolder, TabType } from "@/types/ui-types";

export function HostsPanel({
  onOpenTab,
  onEditHost,
  hostTree,
  onEditingChange,
}: {
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  hostTree?: HostFolder;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [hostSearch, setHostSearch] = useState("");
  const [managerEditing, setManagerEditing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

  function handleEditingChange(editing: boolean) {
    setManagerEditing(editing);
    onEditingChange?.(editing);
  }

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {!managerEditing && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 shrink-0 border-b border-border/60">
          <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60 rounded-sm flex-1 min-w-0">
            <Search className="size-3 text-muted-foreground/60 shrink-0" />
            <input
              value={hostSearch}
              onChange={(e) => setHostSearch(e.target.value)}
              placeholder={t("hosts.searchHosts")}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
            />
            {hostSearch && (
              <button
                onClick={() => setHostSearch("")}
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <button
            title={t("hosts.selectHosts")}
            onClick={toggleSelectionMode}
            className={`flex items-center justify-center size-7 rounded-sm shrink-0 transition-colors ${selectionMode ? "text-accent-brand bg-accent-brand/10 border border-accent-brand/30" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 border border-transparent"}`}
          >
            <ListChecks className="size-3.5" />
          </button>
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("host-manager:add-host"))
            }
            title={t("hosts.addHost")}
            className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 border border-accent-brand/30 rounded-sm shrink-0 transition-colors"
          >
            <Plus className="size-3 shrink-0" />
            {t("hosts.addHost")}
          </button>
        </div>
      )}

      <div
        className={`flex flex-col flex-1 min-h-0 ${managerEditing ? "hidden" : ""}`}
      >
        <SidebarTree
          children={hostTree?.children ?? []}
          onOpenTab={onOpenTab}
          onEditHost={onEditHost}
          query={hostSearch.trim().toLowerCase()}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
        />
      </div>

      <div
        className={managerEditing ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <HostManager onEditingChange={handleEditingChange} />
      </div>
    </div>
  );
}
