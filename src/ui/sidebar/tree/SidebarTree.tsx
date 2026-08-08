import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box,
  Boxes,
  ChevronDown,
  Download,
  FolderOpen,
  FolderSearch,
  Loader2,
  Network,
  Server,
  Terminal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { toast } from "sonner";
import {
  bulkUpdateSSHHosts,
  createSSHHost,
  deleteSSHHost,
  renameFolder,
  updateFolderMetadata,
  deleteAllHostsInFolder,
  reorderSSHHosts,
  reorderFolders,
} from "@/main-axios";
import {
  computeDropSortOrder,
  renumberSiblings,
} from "@/sidebar/reorder-utils";
import type { Host, HostFolder, TabType } from "@/types/ui-types";
import type { SSHHostData } from "@/types/index";
import type { SortKey } from "@/sidebar/host-sort";
import type {
  HostDensity,
  HostTrayTrigger,
} from "@/types/host-sidebar-preferences";
import { resolveHostTabType } from "@/lib/host-connection-tabs";
import { canEditHost } from "@/sidebar/host-permissions";
import { FolderMetadataDialog } from "@/sidebar/FolderMetadataDialog";
import { HostShareModal } from "@/sidebar/HostShareModal";
import { HostItem } from "./HostItem/HostItem";
import { FolderItem, folderHostCount } from "./FolderItem/FolderItem";
import {
  isFolder,
  collectVisibleRows,
  collectAllHosts,
  collectAllFolderPaths,
} from "./visible-rows";
import { useSidebarSelection } from "./hooks/useSidebarSelection";
import { useSidebarDragState } from "./hooks/useSidebarDragState";

export function SidebarTree({
  children,
  onOpenTab,
  onEditHost,
  onShareHost,
  onProxmoxDiscover,
  query = "",
  selectionMode,
  onToggleSelectionMode,
  loading = false,
  onExportSelected,
  sortKey = "default",
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
}: {
  children: (Host | HostFolder)[];
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  onShareHost?: (host: Host) => void;
  onProxmoxDiscover?: (host: Host) => void;
  query?: string;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  loading?: boolean;
  onExportSelected?: (hostIds: string[]) => void;
  sortKey?: SortKey;
  density?: HostDensity;
  trayTrigger?: HostTrayTrigger;
  showTags?: boolean;
}) {
  const { t } = useTranslation();
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("hostOpenFolders");
      return saved ? new Set<string>(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const {
    selectedHostIds,
    setSelectedHostIds,
    openMenuHostId,
    setOpenMenuHostId,
    openTrayHostId,
    setOpenTrayHostId,
    toggleSelect,
  } = useSidebarSelection();
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const { draggedHostIds, setDraggedHostIds, rootDragOver, setRootDragOver } =
    useSidebarDragState();
  const [folderDialog, setFolderDialog] = useState<{
    mode: "create" | "edit";
    folder?: HostFolder;
  } | null>(null);
  const [shareFolderTarget, setShareFolderTarget] = useState<string | null>(
    null,
  );
  // Tracks the single item being dragged in manual sort mode, separate from
  // draggedHostIds (which drives multi-select folder-assignment drops).
  const [draggedReorderKey, setDraggedReorderKey] = useState<string | null>(
    null,
  );
  // Tracks which single row is currently the drop target during a manual
  // reorder drag, lifted here (rather than local state per row) so only one
  // row can ever show the drop-indicator bar at a time -- per-row local
  // state could get stuck showing a stale bar when the pointer jumped
  // directly from one virtualized row to another without a clean
  // dragleave firing on the row being left.
  const [reorderHoverKey, setReorderHoverKey] = useState<string | null>(null);
  const [reorderHoverEdge, setReorderHoverEdge] = useState<
    "before" | "after" | null
  >(null);
  const reorderMode = sortKey === "manual";

  const hostsById = useMemo(() => {
    const map = new Map<string, Host>();
    for (const host of collectAllHosts(children)) map.set(host.id, host);
    return map;
  }, [children]);

  function handleDragHostStart(hostId: string) {
    // When the dragged host is part of an active selection, move the whole set.
    if (selectionMode && selectedHostIds.has(hostId)) {
      setDraggedHostIds([...selectedHostIds]);
    } else {
      setDraggedHostIds([hostId]);
    }
  }

  async function handleMoveHostsToFolder(
    hostIds: string[],
    targetPath: string,
  ) {
    setDraggedHostIds(null);
    // A selection can mix owned hosts with shared ones the recipient may not
    // edit; moving those would fail server-side and take the whole batch down.
    const movableIds = hostIds.filter((id) => {
      const host = hostsById.get(id);
      return !host || canEditHost(host);
    });
    if (movableIds.length === 0) return;

    // Folders only exist visibly via an sshFolders metadata row or by having
    // hosts in them (see buildHostTree in AppShell.tsx). A folder that was
    // never explicitly created and loses its last host here would otherwise
    // vanish with no trace the moment this move lands -- persist it first so
    // it stays visible-but-empty until the user explicitly deletes it.
    const sourceFolders = new Set(
      movableIds
        .map((id) => hostsById.get(id)?.folder)
        .filter((f): f is string => !!f && f !== targetPath),
    );
    const emptiedFolders = [...sourceFolders].filter((path) => {
      const remaining = collectAllHosts(children).filter(
        (h) => h.folder === path && !movableIds.includes(h.id),
      );
      return remaining.length === 0;
    });

    try {
      await bulkUpdateSSHHosts(movableIds.map(Number), { folder: targetPath });
      await Promise.all(
        emptiedFolders.map((path) =>
          updateFolderMetadata(path).catch(() => {
            /* best-effort; worst case the folder disappears as before */
          }),
        ),
      );
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      toast.success(
        t("hosts.movedToFolder", {
          count: movableIds.length,
          folder: targetPath || t("hosts.folderPickerNone"),
        }),
      );
    } catch {
      toast.error(t("hosts.failedToMoveHosts"));
    }
  }

  /**
   * Manual drag-to-reorder. Only active in "manual" sort mode -- in every
   * other mode, dropping a host on a folder keeps its existing
   * folder-reassignment behavior instead. Computes a midpoint sortOrder
   * between the two neighbors the item was dropped between; when that gap is
   * exhausted, renumbers the whole sibling group with fresh evenly-spaced
   * values first.
   */
  async function handleReorderDrop(
    targetKey: string,
    position: "before" | "after",
  ) {
    const draggedKey = draggedReorderKey;
    setDraggedReorderKey(null);
    if (!draggedKey || draggedKey === targetKey) return;
    const [draggedType, draggedId] = draggedKey.split(":", 2);
    const [targetType, targetId] = targetKey.split(":", 2);
    if (draggedType !== targetType) return;

    const siblings = visibleRows.filter((row) => {
      const key = isFolder(row.item)
        ? `folder:${row.item.path ?? row.item.name}`
        : `host:${row.item.id}`;
      const rowType = key.split(":", 2)[0];
      return rowType === draggedType;
    });
    const targetIndex = siblings.findIndex((row) => {
      const item = row.item;
      const id = isFolder(item) ? (item.path ?? item.name) : item.id;
      return id === targetId;
    });
    if (targetIndex === -1) return;

    const beforeItem =
      position === "before"
        ? (siblings[targetIndex - 1]?.item ?? null)
        : siblings[targetIndex].item;
    const afterItem =
      position === "before"
        ? siblings[targetIndex].item
        : (siblings[targetIndex + 1]?.item ?? null);

    const before = beforeItem
      ? { sortOrder: (beforeItem as { sortOrder?: number | null }).sortOrder }
      : null;
    const after = afterItem
      ? { sortOrder: (afterItem as { sortOrder?: number | null }).sortOrder }
      : null;

    const sortOrder = computeDropSortOrder(before, after);

    try {
      if (sortOrder === null) {
        // Gap exhausted: renumber the whole sibling group, then re-derive the
        // dragged item's new position against the fresh values.
        const orderedIds = siblings.map((row) => ({
          id: isFolder(row.item)
            ? (row.item.path ?? row.item.name)
            : row.item.id,
        }));
        const withoutDragged = orderedIds.filter((o) => o.id !== draggedId);
        const targetPos = withoutDragged.findIndex((o) => o.id === targetId);
        const insertAt = position === "before" ? targetPos : targetPos + 1;
        withoutDragged.splice(insertAt, 0, { id: draggedId });
        const renumbered = renumberSiblings(withoutDragged);

        if (draggedType === "host") {
          await reorderSSHHosts(
            renumbered.map((r) => ({
              id: Number(r.id),
              sortOrder: r.sortOrder,
            })),
          );
        } else {
          await reorderFolders(
            renumbered.map((r) => ({
              name: String(r.id),
              sortOrder: r.sortOrder,
            })),
          );
        }
        window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
        return;
      }

      if (draggedType === "host") {
        await reorderSSHHosts([{ id: Number(draggedId), sortOrder }]);
      } else {
        await reorderFolders([{ name: draggedId, sortOrder }]);
      }
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
    } catch {
      toast.error(t("hosts.failedToReorder"));
    }
  }

  function handleManageFolder(folder: HostFolder) {
    setFolderDialog({ mode: "edit", folder });
  }

  function handleOpenAllSessions(folder: HostFolder) {
    const hosts = collectAllHosts(folder.children);
    for (const host of hosts) {
      const type = resolveHostTabType(host);
      onOpenTab(host, type);
    }
  }

  async function handleSaveFolderMetadata(value: {
    name: string;
    color: string;
    icon: string;
    credentialId: number | null;
  }) {
    const existing = folderDialog?.folder;
    try {
      if (existing) {
        const oldPath = existing.path ?? existing.name;
        const parent = oldPath.includes(" / ")
          ? oldPath.slice(0, oldPath.lastIndexOf(" / "))
          : "";
        const newPath = parent ? `${parent} / ${value.name}` : value.name;
        if (newPath !== oldPath) {
          await renameFolder(oldPath, newPath);
        }
        await updateFolderMetadata(
          newPath,
          value.color,
          value.icon,
          value.credentialId,
        );
      } else {
        await updateFolderMetadata(
          value.name,
          value.color,
          value.icon,
          value.credentialId,
        );
      }
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      toast.success(t("hosts.folderSaved"));
    } catch {
      toast.error(t("hosts.failedToSaveFolder"));
    }
  }

  function handleDeleteFolder(folder: HostFolder) {
    const folderPath = folder.path ?? folder.name;
    const { total } = folderHostCount(folder);
    setConfirmDialog({
      message: t("hosts.deleteFolderConfirm", {
        name: folder.name,
        count: total,
      }),
      onConfirm: async () => {
        try {
          await deleteAllHostsInFolder(folderPath);
          window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
          toast.success(t("hosts.folderDeleted", { name: folder.name }));
        } catch {
          toast.error(t("hosts.failedToDeleteFolder"));
        }
      },
    });
  }

  useEffect(() => {
    const openCreate = () => setFolderDialog({ mode: "create" });
    const expandAll = () => {
      const next = new Set(collectAllFolderPaths(children));
      persistOpenFolders(next);
      setOpenFolders(next);
    };
    const collapseAll = () => {
      const next = new Set<string>();
      persistOpenFolders(next);
      setOpenFolders(next);
    };
    window.addEventListener("hosts:create-folder", openCreate);
    window.addEventListener("hosts:expand-all", expandAll);
    window.addEventListener("hosts:collapse-all", collapseAll);
    return () => {
      window.removeEventListener("hosts:create-folder", openCreate);
      window.removeEventListener("hosts:expand-all", expandAll);
      window.removeEventListener("hosts:collapse-all", collapseAll);
    };
  }, [children]);

  function persistOpenFolders(next: Set<string>) {
    try {
      localStorage.setItem("hostOpenFolders", JSON.stringify([...next]));
    } catch {
      // ignore quota/serialization failures
    }
  }

  function toggleFolder(name: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      persistOpenFolders(next);
      return next;
    });
  }

  function handleDeleteHost(host: Host) {
    setConfirmDialog({
      message: t("hosts.deleteHostConfirm", { name: host.name }),
      onConfirm: async () => {
        try {
          await deleteSSHHost(Number(host.id));
          window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
          toast.success(t("hosts.deletedCount", { count: 1 }));
        } catch {
          toast.error(t("hosts.failedToDeleteCount", { count: 1 }));
        }
      },
    });
  }

  async function handleDuplicateHost(host: Host) {
    try {
      const duplicateHost: SSHHostData = {
        name: `${host.name} (copy)`,
        ip: host.ip,
        port: host.port,
        username: host.username,
        folder: host.folder,
        tags: host.tags ?? [],
        pin: host.pin ?? false,
        notes: host.notes,
        macAddress: host.macAddress,
        // Key material is never sent to the frontend, so a cloned key-auth
        // host would have authType "key" with no key — unusable. Reset to
        // password so the clone is in a connectable (editable) state.
        authType: host.authType === "key" ? "password" : host.authType,
        password: host.authType === "key" ? null : (host.password ?? null),
        key: null,
        keyPassword: null,
        keyType: null,
        credentialId: host.credentialId ? Number(host.credentialId) : null,
        overrideCredentialUsername: host.overrideCredentialUsername ?? false,
        enableSsh: host.enableSsh,
        enableRdp: host.enableRdp,
        enableVnc: host.enableVnc,
        enableTelnet: host.enableTelnet,
        enableTerminal: host.enableTerminal,
        enableTunnel: host.enableTunnel,
        enableFileManager: host.enableFileManager,
        enableDocker: host.enableDocker,
        sshPort: host.sshPort,
        rdpPort: host.rdpPort,
        vncPort: host.vncPort,
        telnetPort: host.telnetPort,
        rdpUser: host.rdpUser ?? null,
        rdpPassword: host.rdpPassword ?? null,
        rdpDomain: host.domain ?? null,
        rdpSecurity: host.security ?? null,
        rdpIgnoreCert: host.ignoreCert ?? false,
        vncAuthType: host.vncAuthType ?? null,
        vncCredentialId: host.vncCredentialId ?? null,
        vncPassword: host.vncPassword ?? null,
        vncUser: host.vncUser ?? null,
        telnetUser: host.telnetUser ?? null,
        telnetPassword: host.telnetPassword ?? null,
        defaultPath: host.defaultPath ?? "/",
        forceKeyboardInteractive: host.forceKeyboardInteractive ?? false,
        useSocks5: host.useSocks5,
        socks5Host: host.socks5Host ?? null,
        socks5Port: host.socks5Port ?? null,
        socks5Username: host.socks5Username ?? null,
        socks5Password: host.socks5Password ?? null,
        socks5ProxyChain: host.socks5ProxyChain ?? null,
        jumpHosts: (host.jumpHosts ?? []).map((j) => ({
          hostId: Number(j.hostId),
        })),
        portKnockSequence: host.portKnockSequence ?? [],
        tunnelConnections: host.serverTunnels ?? [],
        quickActions: (host.quickActions ?? []).map((a) => ({
          name: a.name,
          snippetId: Number(a.snippetId),
        })),
        statsConfig: host.statsConfig,
        guacamoleConfig: host.guacamoleConfig ?? null,
        terminalConfig: host.terminalConfig ?? null,
      };
      await createSSHHost(duplicateHost);
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      toast.success(t("hosts.duplicatedHost", { name: host.name }));
    } catch {
      toast.error(t("hosts.failedToDuplicateHost"));
    }
  }

  const allHosts = collectAllHosts(children);
  const allFolderPaths = collectAllFolderPaths(children);

  const visibleRows = collectVisibleRows(children, query, openFolders);
  const parentRef = useRef<HTMLDivElement>(null);

  const isTouchOnly =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const alwaysShowActions = trayTrigger === "always";
  const actionsOnly = trayTrigger === "actionsOnly";
  const clickTrayActive =
    !alwaysShowActions &&
    !actionsOnly &&
    (trayTrigger === "click" || isTouchOnly);
  const isCompactDensity = density === "compact";

  // Fixed, exactly-computed row heights rather than estimate-then-measure:
  // the redesigned rows have a small, known set of shapes (folder header,
  // host closed, host with its tray open, in each density), so there is
  // nothing left to discover at layout time. estimateSize doubled as the
  // real size unconditionally used to cause visible gaps between rows --
  // ResizeObserver-based remeasuring raced the tray's open/close transition
  // and could lock in a stale height for a row that happened to get measured
  // mid-animation. A fixed lookup has no such window: every row's height is
  // decided before the virtualizer ever asks.
  // Re-measured live after fixing two padding bugs: (1) the comfortable-
  // density row's top/bottom padding asymmetry (was pt-2.5 pb-2, now the
  // symmetric py-2), and (2) redundant stacked top padding between the
  // always-visible connection-buttons row and the management-buttons row
  // (the tray wrapper's own pt-1.5 plus the management row's separate
  // pt-1 mt-0.5 compounded into a much larger gap there than between any
  // other pair of rows in the card).
  const HOST_ROW_HEIGHT = isCompactDensity ? 27.5 : 45;
  const FOLDER_ROW_HEIGHT = 31.5;
  // "always" mode permanently renders the connection-buttons row (plus the
  // management row/resource bars for online hosts) -- measured directly
  // rather than derived, since it has its own fixed shape.
  const ALWAYS_ROW_HEIGHT = isCompactDensity ? 73.75 : 100.25;
  const OPEN_TRAY_EXTRA = ALWAYS_ROW_HEIGHT - HOST_ROW_HEIGHT;
  // "actionsOnly" permanently renders just the connection-buttons row above
  // the tray; the management row/resource bars stay collapsed until toggled.
  const ACTIONS_ONLY_ROW_HEIGHT = isCompactDensity ? 50.25 : 75.75;
  // Opening the management row from actionsOnly's closed state (which
  // already includes the connection row).
  const ACTIONS_ONLY_OPEN_ROW_HEIGHT = isCompactDensity ? 79.25 : 104.75;

  const rowHeight = useCallback(
    (index: number) => {
      const row = visibleRows[index];
      if (!row) return FOLDER_ROW_HEIGHT;
      if (isFolder(row.item)) return FOLDER_ROW_HEIGHT;
      if (alwaysShowActions) return ALWAYS_ROW_HEIGHT;
      const isOpen =
        (openTrayHostId === row.item.id || openMenuHostId === row.item.id) &&
        (clickTrayActive || actionsOnly);
      if (actionsOnly) {
        return isOpen ? ACTIONS_ONLY_OPEN_ROW_HEIGHT : ACTIONS_ONLY_ROW_HEIGHT;
      }
      return isOpen ? HOST_ROW_HEIGHT + OPEN_TRAY_EXTRA : HOST_ROW_HEIGHT;
    },
    [
      visibleRows,
      openTrayHostId,
      openMenuHostId,
      clickTrayActive,
      alwaysShowActions,
      actionsOnly,
      HOST_ROW_HEIGHT,
      OPEN_TRAY_EXTRA,
      ALWAYS_ROW_HEIGHT,
      ACTIONS_ONLY_ROW_HEIGHT,
      ACTIONS_ONLY_OPEN_ROW_HEIGHT,
    ],
  );

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: rowHeight,
    overscan: 12,
    getItemKey: (index) => {
      const row = visibleRows[index];
      if (!row) return index;
      return isFolder(row.item)
        ? `folder:${row.item.path ?? row.item.name}`
        : `host:${row.item.id}`;
    },
  });

  // Fixed heights mean estimateSize already IS the real size, so there is
  // nothing for measureElement/ResizeObserver to correct -- but the
  // virtualizer still needs telling when a row's height classification
  // changes (tray opened/closed, tree reshaped, density/trigger changed),
  // since it otherwise keeps using the size it last computed for that key.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [
    virtualizer,
    openFolders,
    openTrayHostId,
    openMenuHostId,
    query,
    visibleRows.length,
    density,
    trayTrigger,
  ]);

  if (loading) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1.5">
          {[28, 20, 24, 20, 28, 20].map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-2 ${i % 2 === 1 ? "ml-4" : ""}`}
            >
              <div className="size-3 rounded-sm bg-muted/50 animate-pulse shrink-0" />
              <div
                className="h-3 rounded bg-muted/50 animate-pulse"
                style={{ width: `${w * 3}px` }}
              />
            </div>
          ))}
          <div className="flex items-center justify-center gap-2 pt-4 text-muted-foreground/40">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-xs">{t("hosts.loadingHosts")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      <div
        ref={parentRef}
        className={`flex-1 min-h-0 overflow-y-auto ${rootDragOver ? "ring-1 ring-inset ring-accent-brand/50" : ""}`}
        onDragOver={(e) => {
          if (draggedHostIds) {
            e.preventDefault();
            setRootDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setRootDragOver(false);
        }}
        onDrop={(e) => {
          if (draggedHostIds) {
            e.preventDefault();
            setRootDragOver(false);
            handleMoveHostsToFolder(draggedHostIds, "");
          }
        }}
      >
        {visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Server className="size-8 text-muted-foreground/20 mb-2" />
            <span className="text-sm font-semibold text-muted-foreground/60">
              {query ? t("hosts.noHostsMatchSearch") : t("hosts.noHostsYet")}
            </span>
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = visibleRows[vItem.index];
              if (!row) return null;
              const { item, depth } = row;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {isFolder(item) ? (
                    <FolderItem
                      folder={item}
                      depth={depth}
                      flat
                      onOpenTab={onOpenTab}
                      onEditHost={onEditHost}
                      onShareHost={onShareHost}
                      onDeleteHost={handleDeleteHost}
                      onDuplicateHost={handleDuplicateHost}
                      onProxmoxDiscover={onProxmoxDiscover}
                      query={query}
                      openFolders={openFolders}
                      onToggleFolder={toggleFolder}
                      selectionMode={selectionMode}
                      selectedHostIds={selectedHostIds}
                      onToggleSelect={toggleSelect}
                      openMenuHostId={openMenuHostId}
                      onMenuOpenChange={setOpenMenuHostId}
                      openTrayHostId={openTrayHostId}
                      onTrayOpenChange={setOpenTrayHostId}
                      onManageFolder={handleManageFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onOpenAllSessions={handleOpenAllSessions}
                      onShareFolder={(folder) =>
                        setShareFolderTarget(folder.path ?? folder.name)
                      }
                      onMoveHostsToFolder={handleMoveHostsToFolder}
                      draggedHostIds={draggedHostIds}
                      onDragHostStart={handleDragHostStart}
                      onDragEnd={() => {
                        setDraggedHostIds(null);
                        setDraggedReorderKey(null);
                        setReorderHoverKey(null);
                        setReorderHoverEdge(null);
                      }}
                      stripeIndex={vItem.index}
                      density={density}
                      trayTrigger={trayTrigger}
                      showTags={showTags}
                      reorderMode={reorderMode}
                      onReorderDrop={handleReorderDrop}
                      onFolderDragStart={(path) =>
                        setDraggedReorderKey(`folder:${path}`)
                      }
                      onFolderDragEnd={() => {
                        setDraggedReorderKey(null);
                        setReorderHoverKey(null);
                        setReorderHoverEdge(null);
                      }}
                      isReorderHovered={
                        reorderHoverKey === `folder:${item.path ?? item.name}`
                      }
                      reorderHoverEdge={reorderHoverEdge}
                      onReorderHoverChange={(edge) => {
                        const key = `folder:${item.path ?? item.name}`;
                        setReorderHoverKey(edge ? key : null);
                        setReorderHoverEdge(edge);
                      }}
                    />
                  ) : (
                    <HostItem
                      host={item}
                      depth={depth}
                      onOpenTab={(type) => onOpenTab(item, type)}
                      onEditHost={() => onEditHost(item)}
                      onShareHost={
                        onShareHost ? () => onShareHost(item) : undefined
                      }
                      onProxmoxDiscover={
                        onProxmoxDiscover
                          ? () => onProxmoxDiscover(item)
                          : undefined
                      }
                      onDelete={() => handleDeleteHost(item)}
                      onDuplicate={() => handleDuplicateHost(item)}
                      query={query}
                      stripeIndex={vItem.index}
                      selectionMode={selectionMode}
                      selected={selectedHostIds.has(item.id)}
                      onToggleSelect={() => toggleSelect(item.id)}
                      isMenuOpen={openMenuHostId === item.id}
                      onMenuOpenChange={(open) =>
                        setOpenMenuHostId(open ? item.id : null)
                      }
                      isTrayOpen={openTrayHostId === item.id}
                      onTrayOpenChange={(open) =>
                        setOpenTrayHostId(open ? item.id : null)
                      }
                      onDragStart={() => {
                        if (reorderMode) {
                          setDraggedReorderKey(`host:${item.id}`);
                          return;
                        }
                        handleDragHostStart(item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedHostIds(null);
                        setReorderHoverKey(null);
                        setReorderHoverEdge(null);
                      }}
                      density={density}
                      trayTrigger={trayTrigger}
                      showTags={showTags}
                      reorderMode={reorderMode}
                      onReorderDrop={(position) =>
                        handleReorderDrop(`host:${item.id}`, position)
                      }
                      isReorderHovered={reorderHoverKey === `host:${item.id}`}
                      reorderHoverEdge={reorderHoverEdge}
                      onReorderHoverChange={(edge) => {
                        setReorderHoverKey(edge ? `host:${item.id}` : null);
                        setReorderHoverEdge(edge);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating selection bar */}
      {selectionMode && (
        <div className="absolute bottom-4 inset-x-3 z-50">
          <div className="bg-popover border border-border shadow-xl px-2.5 py-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold tabular-nums shrink-0">
              {t("hosts.nSelected", { count: selectedHostIds.size })}
            </span>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                if (selectedHostIds.size === allHosts.length)
                  setSelectedHostIds(new Set());
                else setSelectedHostIds(new Set(allHosts.map((h) => h.id)));
              }}
            >
              {selectedHostIds.size === allHosts.length
                ? t("hosts.deselectAll")
                : t("hosts.selectAll")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
                  disabled={selectedHostIds.size === 0}
                >
                  {t("hosts.featuresMenu")} <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                {[
                  {
                    labelKey: "hosts.enableTerminalFeature",
                    field: "enableTerminal",
                    value: true,
                    icon: Terminal,
                  },
                  {
                    labelKey: "hosts.disableTerminalFeature",
                    field: "enableTerminal",
                    value: false,
                    icon: Terminal,
                  },
                  {
                    labelKey: "hosts.enableFilesFeature",
                    field: "enableFileManager",
                    value: true,
                    icon: FolderSearch,
                  },
                  {
                    labelKey: "hosts.disableFilesFeature",
                    field: "enableFileManager",
                    value: false,
                    icon: FolderSearch,
                  },
                  {
                    labelKey: "hosts.enableTunnelsFeature",
                    field: "enableTunnel",
                    value: true,
                    icon: Network,
                  },
                  {
                    labelKey: "hosts.disableTunnelsFeature",
                    field: "enableTunnel",
                    value: false,
                    icon: Network,
                  },
                  {
                    labelKey: "hosts.enableDockerFeature",
                    field: "enableDocker",
                    value: true,
                    icon: Box,
                  },
                  {
                    labelKey: "hosts.disableDockerFeature",
                    field: "enableDocker",
                    value: false,
                    icon: Box,
                  },
                  {
                    labelKey: "hosts.enableProxmoxFeature",
                    field: "enableProxmox",
                    value: true,
                    icon: Boxes,
                  },
                  {
                    labelKey: "hosts.disableProxmoxFeature",
                    field: "enableProxmox",
                    value: false,
                    icon: Boxes,
                  },
                ].map(({ labelKey, field, value, icon: Icon }) => (
                  <DropdownMenuItem
                    key={labelKey}
                    onClick={async () => {
                      const ids = Array.from(selectedHostIds).map(Number);
                      try {
                        await bulkUpdateSSHHosts(ids, { [field]: value });
                        window.dispatchEvent(
                          new CustomEvent("termix:hosts-changed"),
                        );
                        toast.success(
                          t("hosts.updatedCount", { count: ids.length }),
                        );
                      } catch {
                        toast.error(t("hosts.bulkUpdateFailed"));
                      }
                    }}
                  >
                    <Icon className="size-3.5 mr-2" />
                    {t(labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
                  disabled={selectedHostIds.size === 0}
                >
                  {t("hosts.moveMenu")} <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem
                  onClick={async () => {
                    const ids = Array.from(selectedHostIds).map(Number);
                    try {
                      await bulkUpdateSSHHosts(ids, { folder: "" });
                      window.dispatchEvent(
                        new CustomEvent("termix:hosts-changed"),
                      );
                      toast.success(t("hosts.movedToRoot"));
                    } catch {
                      toast.error(t("hosts.failedToMoveHosts"));
                    }
                  }}
                >
                  <FolderOpen className="size-3.5 mr-2" />
                  {t("hosts.noFolderOption")}
                </DropdownMenuItem>
                {allFolderPaths.map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onClick={async () => {
                      const ids = Array.from(selectedHostIds).map(Number);
                      try {
                        await bulkUpdateSSHHosts(ids, { folder: f });
                        window.dispatchEvent(
                          new CustomEvent("termix:hosts-changed"),
                        );
                        toast.success(t("hosts.movedToFolder", { folder: f }));
                      } catch {
                        toast.error(t("hosts.failedToMoveHosts"));
                      }
                    }}
                  >
                    <FolderOpen className="size-3.5 mr-2" />
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
              disabled={selectedHostIds.size === 0}
              onClick={() => {
                onExportSelected?.(Array.from(selectedHostIds));
                setSelectedHostIds(new Set());
                onToggleSelectionMode();
              }}
            >
              <Download className="size-3" />
              {t("hosts.export.bulkButton")}
            </button>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
              disabled={selectedHostIds.size === 0}
              onClick={() => {
                const selectedHosts = allHosts.filter((h) =>
                  selectedHostIds.has(String(h.id)),
                );
                for (const host of selectedHosts) {
                  if (host.enableSsh) onOpenTab(host, "terminal");
                  else if (host.enableRdp) onOpenTab(host, "rdp");
                  else if (host.enableVnc) onOpenTab(host, "vnc");
                  else if (host.enableTelnet) onOpenTab(host, "telnet");
                }
                setSelectedHostIds(new Set());
                onToggleSelectionMode();
              }}
            >
              <Terminal className="size-3" />
              {t("hosts.connectSelected")}
            </button>
            <button
              className="text-[10px] text-destructive hover:text-destructive px-1.5 py-1 hover:bg-destructive/10 rounded transition-colors disabled:opacity-40"
              disabled={selectedHostIds.size === 0}
              onClick={() => {
                setConfirmDialog({
                  message: t("hosts.deleteHostsConfirm", {
                    count: selectedHostIds.size,
                    plural: selectedHostIds.size !== 1 ? "s" : "",
                  }),
                  onConfirm: async () => {
                    const ids = Array.from(selectedHostIds);
                    const results = await Promise.allSettled(
                      ids.map((id) => deleteSSHHost(Number(id))),
                    );
                    const succeeded = results.filter(
                      (r) => r.status === "fulfilled",
                    ).length;
                    const failed = results.filter(
                      (r) => r.status === "rejected",
                    ).length;
                    setSelectedHostIds(new Set());
                    window.dispatchEvent(
                      new CustomEvent("termix:hosts-changed"),
                    );
                    if (succeeded > 0)
                      toast.success(
                        t("hosts.deletedCount", { count: succeeded }),
                      );
                    if (failed > 0)
                      toast.error(
                        t("hosts.failedToDeleteCount", { count: failed }),
                      );
                  },
                });
              }}
            >
              {t("hosts.deleteSelected")}
            </button>
            <div className="flex-1" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                onToggleSelectionMode();
                setSelectedHostIds(new Set());
              }}
            >
              {t("hosts.cancelSelection")}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-xs flex flex-col gap-4 p-4">
            <p className="text-sm text-foreground">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                {t("hosts.cancelBtn")}
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                {t("hosts.deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      <FolderMetadataDialog
        open={folderDialog !== null}
        mode={folderDialog?.mode ?? "create"}
        initial={
          folderDialog?.folder
            ? {
                name: folderDialog.folder.name,
                color: folderDialog.folder.color,
                icon: folderDialog.folder.icon,
                credentialId: folderDialog.folder.credentialId,
              }
            : undefined
        }
        existingPaths={allFolderPaths}
        currentPath={
          folderDialog?.folder
            ? (folderDialog.folder.path ?? folderDialog.folder.name)
            : undefined
        }
        onOpenChange={(v) => !v && setFolderDialog(null)}
        onSubmit={handleSaveFolderMetadata}
      />

      <HostShareModal
        open={shareFolderTarget !== null}
        onClose={() => setShareFolderTarget(null)}
        host={null}
        folder={shareFolderTarget}
      />
    </div>
  );
}
