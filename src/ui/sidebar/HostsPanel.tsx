import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Settings, X } from "lucide-react";
import { SidebarTree } from "@/sidebar/SidebarTree";
import { HostManager } from "@/sidebar/HostManager";
import type { Host, HostFolder, TabType } from "@/types/ui-types";
import type { MutableRefObject } from "react";

export function HostsPanel({
  expanded,
  onExpand,
  onCollapse,
  pendingEditId,
  pendingAction,
  onOpenTab,
  onEditHost,
  hostTree,
}: {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  pendingEditId: MutableRefObject<string | null>;
  pendingAction: MutableRefObject<"add-host" | "add-credential" | null>;
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  hostTree?: HostFolder;
}) {
  const { t } = useTranslation();
  const [hostSearch, setHostSearch] = useState("");

  if (expanded) {
    return (
      <HostManager
        onCollapse={onCollapse}
        pendingEditId={pendingEditId}
        pendingAction={pendingAction}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
          onClick={onExpand}
          title="Manage Hosts"
          className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60 rounded-sm shrink-0 transition-colors"
        >
          <Settings className="size-3 shrink-0" />
          Manage
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        <SidebarTree
          children={hostTree?.children ?? []}
          onOpenTab={onOpenTab}
          onEditHost={onEditHost}
          query={hostSearch.trim().toLowerCase()}
        />
      </div>
    </div>
  );
}
