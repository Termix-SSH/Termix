/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Host, HostFolder, TabType } from "@/types/ui-types";
import type {
  HostDensity,
  HostTrayTrigger,
} from "@/types/host-sidebar-preferences";
import { FolderIconEl } from "@/components/folder-style";
import { useServerStatus } from "@/lib/ServerStatusContext";
import { HostItem, statusCheckEnabled } from "../HostItem/HostItem";
import { isFolder, folderHasMatch, collectAllHosts } from "../visible-rows";
import { FolderActions } from "./FolderActions";

export function folderHostCount(folder: HostFolder): {
  total: number;
  online: number;
} {
  let total = 0,
    online = 0;
  for (const child of folder.children) {
    if (isFolder(child)) {
      const c = folderHostCount(child);
      total += c.total;
      online += c.online;
    } else {
      total++;
      if (child.online) online++;
    }
  }
  return { total, online };
}

export function FolderItem({
  folder,
  depth = 0,
  onOpenTab,
  onEditHost,
  onShareHost,
  onDeleteHost,
  onDuplicateHost,
  onProxmoxDiscover,
  query = "",
  stripeMap,
  openFolders,
  onToggleFolder,
  selectionMode,
  selectedHostIds,
  onToggleSelect,
  openMenuHostId,
  onMenuOpenChange,
  openTrayHostId,
  onTrayOpenChange,
  onManageFolder,
  onDeleteFolder,
  onOpenAllSessions,
  onShareFolder,
  onMoveHostsToFolder,
  draggedHostIds,
  onDragHostStart,
  onDragEnd,
  /** When true, only render the folder header (children come from the virtual list). */
  flat = false,
  stripeIndex: stripeIndexProp,
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
  reorderMode = false,
  onReorderDrop,
  onFolderDragStart,
  onFolderDragEnd,
  isReorderHovered = false,
  reorderHoverEdge = null,
  onReorderHoverChange,
}: {
  folder: HostFolder;
  depth?: number;
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost?: (host: Host) => void;
  onShareHost?: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  onDuplicateHost: (host: Host) => void;
  onProxmoxDiscover?: (host: Host) => void;
  query?: string;
  stripeMap?: Map<Host | HostFolder, number>;
  openFolders: Set<string>;
  onToggleFolder: (name: string) => void;
  selectionMode: boolean;
  selectedHostIds: Set<string>;
  onToggleSelect: (id: string) => void;
  openMenuHostId: string | null;
  onMenuOpenChange: (hostId: string | null) => void;
  openTrayHostId: string | null;
  onTrayOpenChange: (hostId: string | null) => void;
  onManageFolder: (folder: HostFolder) => void;
  onDeleteFolder: (folder: HostFolder) => void;
  onOpenAllSessions: (folder: HostFolder) => void;
  onShareFolder?: (folder: HostFolder) => void;
  onMoveHostsToFolder: (hostIds: string[], targetPath: string) => void;
  draggedHostIds: string[] | null;
  onDragHostStart: (hostId: string) => void;
  onDragEnd: () => void;
  flat?: boolean;
  stripeIndex?: number;
  density?: HostDensity;
  trayTrigger?: HostTrayTrigger;
  showTags?: boolean;
  /** When true (manual sort mode), the top/bottom edges become reorder drop zones instead of folder-assignment. */
  reorderMode?: boolean;
  onReorderDrop?: (targetKey: string, position: "before" | "after") => void;
  onFolderDragStart?: (folderPath: string) => void;
  onFolderDragEnd?: () => void;
  /** Whether THIS folder header is the current reorder drop target -- see
   * HostItem's identical prop for why this is lifted rather than local. */
  isReorderHovered?: boolean;
  reorderHoverEdge?: "before" | "after" | null;
  onReorderHoverChange?: (edge: "before" | "after" | null) => void;
}) {
  const { getStatus, initialLoadComplete } = useServerStatus();
  const { total } = folderHostCount(folder);
  const online = initialLoadComplete
    ? collectAllHosts(folder.children).filter(
        (h) => statusCheckEnabled(h) && getStatus(Number(h.id)) === "online",
      ).length
    : folderHostCount(folder).online;
  const [dragOver, setDragOver] = useState(false);
  const reorderEdge = isReorderHovered ? reorderHoverEdge : null;

  if (query && !folderHasMatch(folder, query)) return null;

  const folderPath = folder.path ?? folder.name;
  const isOpen = query ? true : openFolders.has(folderPath);
  const stripeIndex = stripeIndexProp ?? stripeMap?.get(folder) ?? 0;
  // Synthetic group headers (group-by tag/status/etc.) are not real folders, so
  // they can't be edited, deleted, or used as drop targets.
  const isGroup = folderPath.startsWith("__group__:");
  // Nested folders show their parent path as a muted breadcrumb so depth stays
  // legible even when a folder is reached via search auto-expand rather than
  // by manually opening every ancestor.
  const pathSegments = isGroup ? [] : folderPath.split(" / ");
  const breadcrumb =
    pathSegments.length > 1 ? pathSegments.slice(0, -1).join(" / ") : null;

  return (
    <div
      className="relative"
      style={depth > 0 ? { paddingLeft: depth * 12 } : undefined}
      onDragOver={(e) => {
        if (reorderMode && onReorderDrop && !isGroup) {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onReorderHoverChange?.(
            e.clientY - rect.top < rect.height / 2 ? "before" : "after",
          );
          return;
        }
        if (draggedHostIds && !isGroup) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        if (reorderMode && onReorderDrop && !isGroup && reorderEdge) {
          e.preventDefault();
          e.stopPropagation();
          onReorderDrop(`folder:${folderPath}`, reorderEdge);
          onReorderHoverChange?.(null);
          return;
        }
        if (draggedHostIds && !isGroup) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          onMoveHostsToFolder(draggedHostIds, folderPath);
        }
      }}
    >
      {reorderMode && reorderEdge && (
        <div
          className={`absolute inset-x-0 h-0.5 bg-accent-brand pointer-events-none z-10 ${reorderEdge === "before" ? "top-0" : "bottom-0"}`}
        />
      )}
      <button
        draggable={reorderMode && !isGroup}
        onDragStart={(e) => {
          if (!reorderMode || isGroup) return;
          e.dataTransfer.effectAllowed = "move";
          onFolderDragStart?.(folderPath);
        }}
        onDragEnd={() => onFolderDragEnd?.()}
        onClick={() => !query && onToggleFolder(folderPath)}
        className={`group/folder flex items-center gap-2 w-full pl-2.5 pr-2 py-1.5 transition-colors text-left cursor-pointer ${
          isOpen ? "bg-muted/40" : "hover:bg-muted/30"
        } ${stripeIndex % 2 === 1 && !isOpen ? "bg-muted/[0.08]" : ""} ${dragOver ? "ring-1 ring-inset ring-accent-brand bg-accent-brand/10" : ""}`}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
        <FolderIconEl
          icon={folder.icon ?? "folder"}
          className={`size-4 shrink-0 ${folder.color ? "" : isOpen ? "text-accent-brand" : "text-muted-foreground/70"}`}
          style={folder.color ? { color: folder.color } : undefined}
        />
        {
          <>
            <span className="min-w-0 flex-1 truncate">
              {breadcrumb && (
                <span className="text-[10px] text-muted-foreground/40 truncate mr-1">
                  {breadcrumb} /
                </span>
              )}
              <span className="text-[13px] font-bold text-foreground tracking-tight">
                {folder.name}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[10px] tabular-nums shrink-0 ml-1 px-1.5 py-[1px] bg-muted/70">
              {online > 0 && (
                <span className="text-accent-brand font-semibold">
                  {online}
                </span>
              )}
              <span className="text-muted-foreground/50">/{total}</span>
            </span>
            {!isGroup && (
              <FolderActions
                folder={folder}
                onOpenAllSessions={onOpenAllSessions}
                onShareFolder={onShareFolder}
                onManageFolder={onManageFolder}
                onDeleteFolder={onDeleteFolder}
              />
            )}
          </>
        }
      </button>
      {!flat && isOpen && (
        <div className="border-l border-border/50 ml-[27px]">
          {folder.children.map((child, i) =>
            isFolder(child) ? (
              <FolderItem
                key={i}
                folder={child}
                depth={depth + 1}
                onOpenTab={onOpenTab}
                onEditHost={onEditHost}
                onShareHost={onShareHost}
                onDeleteHost={onDeleteHost}
                onDuplicateHost={onDuplicateHost}
                onProxmoxDiscover={onProxmoxDiscover}
                query={query}
                stripeMap={stripeMap}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
                selectionMode={selectionMode}
                selectedHostIds={selectedHostIds}
                onToggleSelect={onToggleSelect}
                openMenuHostId={openMenuHostId}
                onMenuOpenChange={onMenuOpenChange}
                openTrayHostId={openTrayHostId}
                onTrayOpenChange={onTrayOpenChange}
                onManageFolder={onManageFolder}
                onDeleteFolder={onDeleteFolder}
                onOpenAllSessions={onOpenAllSessions}
                onShareFolder={onShareFolder}
                onMoveHostsToFolder={onMoveHostsToFolder}
                draggedHostIds={draggedHostIds}
                onDragHostStart={onDragHostStart}
                onDragEnd={onDragEnd}
                density={density}
                trayTrigger={trayTrigger}
                showTags={showTags}
                reorderMode={reorderMode}
                onReorderDrop={onReorderDrop}
                onFolderDragStart={onFolderDragStart}
                onFolderDragEnd={onFolderDragEnd}
              />
            ) : (
              <HostItem
                key={i}
                host={child}
                onOpenTab={(t) => onOpenTab(child, t)}
                onEditHost={onEditHost ? () => onEditHost(child) : undefined}
                onShareHost={onShareHost ? () => onShareHost(child) : undefined}
                onProxmoxDiscover={
                  onProxmoxDiscover ? () => onProxmoxDiscover(child) : undefined
                }
                onDelete={() => onDeleteHost(child)}
                onDuplicate={() => onDuplicateHost(child)}
                query={query}
                stripeIndex={stripeMap?.get(child) ?? 0}
                selectionMode={selectionMode}
                selected={selectedHostIds.has(child.id)}
                onToggleSelect={() => onToggleSelect(child.id)}
                isMenuOpen={openMenuHostId === child.id}
                onMenuOpenChange={(open) =>
                  onMenuOpenChange(open ? child.id : null)
                }
                isTrayOpen={openTrayHostId === child.id}
                onTrayOpenChange={(open) =>
                  onTrayOpenChange(open ? child.id : null)
                }
                onDragStart={() => onDragHostStart(child.id)}
                onDragEnd={onDragEnd}
                density={density}
                trayTrigger={trayTrigger}
                showTags={showTags}
                reorderMode={reorderMode}
                onReorderDrop={
                  onReorderDrop
                    ? (position) => onReorderDrop(`host:${child.id}`, position)
                    : undefined
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
