import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { reorderCredentials, reorderFolders } from "@/main-axios";
import {
  computeDropSortOrder,
  renumberSiblings,
} from "@/sidebar/reorder-utils";
import type { Credential } from "@/types/ui-types";
import type {
  CredentialDensity,
  CredentialSortKey,
  CredentialTrayTrigger,
} from "@/types/credential-sidebar-preferences";
import { CredentialItem } from "./CredentialItem/CredentialItem";
import { CredentialFolderItem } from "./FolderItem/CredentialFolderItem";
import {
  isFolder,
  collectVisibleRows,
  collectAllFolderNames,
  type CredentialFolder,
} from "./visible-rows";

export function CredentialSidebarTree({
  folders,
  onDeployCredential,
  onEditCredential,
  onDeleteCredential,
  usedByCounts,
  termixIdLinkedIds,
  query = "",
  loading = false,
  sortKey = "default",
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
  editingFolderName,
  editingFolderValue,
  onEditingFolderNameChange,
  onEditingFolderValueChange,
  onRenameFolder,
  onDeleteFolder,
  onMoveCredentialToFolder,
}: {
  folders: CredentialFolder[];
  onDeployCredential: (cred: Credential) => void;
  onEditCredential: (cred: Credential) => void;
  onDeleteCredential: (cred: Credential) => void;
  usedByCounts?: Map<string, number>;
  termixIdLinkedIds?: Set<number>;
  query?: string;
  loading?: boolean;
  sortKey?: CredentialSortKey;
  density?: CredentialDensity;
  trayTrigger?: CredentialTrayTrigger;
  showTags?: boolean;
  editingFolderName: string | null;
  editingFolderValue: string;
  onEditingFolderNameChange: (name: string | null) => void;
  onEditingFolderValueChange: (value: string) => void;
  onRenameFolder: (folder: string, newName: string) => Promise<void>;
  onDeleteFolder?: (folder: string) => void;
  /** Drag a credential onto a folder header (outside manual sort mode) to
   * reassign it. Distinct from the manual reorder drag interaction. */
  onMoveCredentialToFolder?: (
    credentialId: string,
    targetFolder: string,
  ) => void;
}) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    () => new Set(collectAllFolderNames(folders)),
  );
  const seenFolderNames = useRef<Set<string>>(
    new Set(collectAllFolderNames(folders)),
  );
  // Folders default to open, but the initial render often happens before
  // credentials finish loading (folders === []), so the useState initializer
  // above freezes on an empty set. Newly-appearing folder names (including
  // the very first load) are added to the open set as they show up; a
  // folder the user has explicitly closed stays closed on future renders
  // since it's already tracked in seenFolderNames.
  useEffect(() => {
    const currentNames = collectAllFolderNames(folders);
    const unseen = currentNames.filter((n) => !seenFolderNames.current.has(n));
    if (unseen.length === 0) return;
    for (const name of unseen) seenFolderNames.current.add(name);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      for (const name of unseen) next.add(name);
      return next;
    });
  }, [folders]);
  const [openTrayCredentialId, setOpenTrayCredentialId] = useState<
    string | null
  >(null);
  const [openMenuCredentialId, setOpenMenuCredentialId] = useState<
    string | null
  >(null);
  const [draggedReorderKey, setDraggedReorderKey] = useState<string | null>(
    null,
  );
  // Tracks the single credential being dragged for folder reassignment,
  // separate from draggedReorderKey (which drives manual-sort-mode
  // position reordering). Only active outside manual sort mode.
  const [draggedCredentialId, setDraggedCredentialId] = useState<string | null>(
    null,
  );
  // Tracks which single row is currently the manual-reorder drop target,
  // lifted here rather than local per-row state so only one row can ever
  // show the drop-indicator bar at a time. See HostItem/SidebarTree's
  // identical fix for the full rationale.
  const [reorderHoverKey, setReorderHoverKey] = useState<string | null>(null);
  const [reorderHoverEdge, setReorderHoverEdge] = useState<
    "before" | "after" | null
  >(null);
  const reorderMode = sortKey === "manual";

  const isTouchOnly =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const alwaysShowActions = trayTrigger === "always";
  const actionsOnly = trayTrigger === "actionsOnly";
  const clickTrayActive =
    !alwaysShowActions &&
    !actionsOnly &&
    (trayTrigger === "click" || isTouchOnly);
  const isCompactDensity = density === "compact";

  const visibleRows = collectVisibleRows(folders, query, openFolders);

  // Fixed, exactly-computed row heights rather than estimate-then-measure,
  // matching SidebarTree.tsx's approach -- estimate-then-measure caused
  // visible gaps between rows there. All constants below were measured live
  // against the running app (Playwright getBoundingClientRect) for every
  // density x trayTrigger x open/closed-tray x credential-type combination.
  //
  // Unlike hosts, credential row height genuinely depends on TYPE, not just
  // density/trayTrigger: only "key" credentials render a connection-buttons
  // row (deploy/copy-command) -- "password" credentials have no connection
  // buttons at all, so a password row is shorter than a key row whenever
  // that row is showing (actionsOnly closed, or always mode).
  const FOLDER_ROW_HEIGHT = 31.5;
  // Base closed height with no persistent extras (hover/click modes,
  // collapsed) -- identical for both credential types since neither the
  // connection row nor the management row is rendered. Re-measured live
  // after fixing the comfortable-density row's top/bottom padding asymmetry
  // (was pt-2.5 pb-2, now the symmetric py-2, 2px shorter).
  const BASE_ROW_HEIGHT = isCompactDensity ? 23 : 45;
  // Fully opened (management row revealed, plus connection row for key
  // creds) -- differs by type since only key creds have a connection row;
  // measured identical for click-mode-open and actionsOnly-mode-open.
  const OPEN_KEY_ROW_HEIGHT = isCompactDensity ? 79.25 : 104.75;
  const OPEN_PASSWORD_ROW_HEIGHT = isCompactDensity ? 56.5 : 78.5;
  // actionsOnly closed (connection row shown permanently, management row
  // still collapsed) -- differs by type since only key creds have a
  // connection row to show.
  const ACTIONS_ONLY_KEY_ROW_HEIGHT = isCompactDensity ? 50.25 : 75.75;
  const ACTIONS_ONLY_PASSWORD_ROW_HEIGHT = isCompactDensity ? 27.5 : 49.5;
  // always mode (both rows permanently shown) -- measured slightly shorter
  // than a click-opened row since the chevron toggle button isn't rendered.
  const ALWAYS_KEY_ROW_HEIGHT = isCompactDensity ? 74.75 : 100.25;
  const ALWAYS_PASSWORD_ROW_HEIGHT = isCompactDensity ? 52 : 74;

  const rowHeight = useCallback(
    (index: number) => {
      const row = visibleRows[index];
      if (!row) return FOLDER_ROW_HEIGHT;
      if (isFolder(row.item)) return FOLDER_ROW_HEIGHT;
      const isKey = row.item.type === "key";

      if (alwaysShowActions) {
        return isKey ? ALWAYS_KEY_ROW_HEIGHT : ALWAYS_PASSWORD_ROW_HEIGHT;
      }

      const isOpen =
        (openTrayCredentialId === row.item.id ||
          openMenuCredentialId === row.item.id) &&
        (clickTrayActive || actionsOnly);

      if (actionsOnly) {
        if (isOpen)
          return isKey ? OPEN_KEY_ROW_HEIGHT : OPEN_PASSWORD_ROW_HEIGHT;
        return isKey
          ? ACTIONS_ONLY_KEY_ROW_HEIGHT
          : ACTIONS_ONLY_PASSWORD_ROW_HEIGHT;
      }

      if (isOpen) return isKey ? OPEN_KEY_ROW_HEIGHT : OPEN_PASSWORD_ROW_HEIGHT;
      return BASE_ROW_HEIGHT;
    },
    [
      visibleRows,
      openTrayCredentialId,
      openMenuCredentialId,
      clickTrayActive,
      alwaysShowActions,
      actionsOnly,
      BASE_ROW_HEIGHT,
      OPEN_KEY_ROW_HEIGHT,
      OPEN_PASSWORD_ROW_HEIGHT,
      ACTIONS_ONLY_KEY_ROW_HEIGHT,
      ACTIONS_ONLY_PASSWORD_ROW_HEIGHT,
      ALWAYS_KEY_ROW_HEIGHT,
      ALWAYS_PASSWORD_ROW_HEIGHT,
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
        ? `folder:${row.item.name}`
        : `cred:${row.item.id}`;
    },
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [
    virtualizer,
    openFolders,
    openTrayCredentialId,
    openMenuCredentialId,
    query,
    visibleRows.length,
    density,
    trayTrigger,
  ]);

  function toggleFolder(name: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /**
   * Manual drag-to-reorder, only active in "manual" sort mode -- same
   * midpoint-then-renumber-on-exhaustion math as SidebarTree.tsx's
   * handleReorderDrop, reused unchanged via reorder-utils.ts.
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
        ? `folder:${row.item.name}`
        : `cred:${row.item.id}`;
      return key.split(":", 2)[0] === draggedType;
    });
    const targetIndex = siblings.findIndex((row) => {
      const item = row.item;
      const id = isFolder(item) ? item.name : item.id;
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
      ? { sortOrder: isFolder(beforeItem) ? undefined : beforeItem.sortOrder }
      : null;
    const after = afterItem
      ? { sortOrder: isFolder(afterItem) ? undefined : afterItem.sortOrder }
      : null;

    const sortOrder = computeDropSortOrder(before, after);

    try {
      if (sortOrder === null) {
        const orderedIds = siblings.map((row) => ({
          id: isFolder(row.item) ? row.item.name : row.item.id,
        }));
        const withoutDragged = orderedIds.filter((o) => o.id !== draggedId);
        const targetPos = withoutDragged.findIndex((o) => o.id === targetId);
        const insertAt = position === "before" ? targetPos : targetPos + 1;
        withoutDragged.splice(insertAt, 0, { id: draggedId });
        const renumbered = renumberSiblings(withoutDragged);

        if (draggedType === "cred") {
          await reorderCredentials(
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
        window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
        return;
      }

      if (draggedType === "cred") {
        await reorderCredentials([{ id: Number(draggedId), sortOrder }]);
      } else {
        await reorderFolders([{ name: draggedId, sortOrder }]);
      }
      window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
    } catch {
      toast.error(t("credentials.failedToReorder"));
    }
  }

  if (loading) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1.5">
          {[60, 45, 55, 40].map((w, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <div className="size-3 bg-muted/50 animate-pulse shrink-0" />
              <div
                className="h-3 bg-muted/50 animate-pulse"
                style={{ width: `${w * 2}px` }}
              />
            </div>
          ))}
          <div className="flex items-center justify-center gap-2 pt-2 text-muted-foreground/40">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-xs">
              {t("credentials.loadingCredentials")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <KeyRound className="size-8 text-muted-foreground/20 mb-2" />
            <span className="text-sm font-semibold text-muted-foreground/60">
              {query
                ? t("credentials.noCredentialsMatchSearch")
                : t("credentials.noCredentialsFound")}
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
                  style={{ transform: `translateY(${vItem.start}px)` }}
                >
                  {isFolder(item) ? (
                    <CredentialFolderItem
                      folder={item}
                      isOpen={openFolders.has(item.name)}
                      stripeIndex={vItem.index}
                      query={query}
                      editingFolderName={editingFolderName}
                      editingFolderValue={editingFolderValue}
                      onToggleFolder={toggleFolder}
                      onEditingFolderNameChange={onEditingFolderNameChange}
                      onEditingFolderValueChange={onEditingFolderValueChange}
                      onRenameFolder={onRenameFolder}
                      onDeleteFolder={onDeleteFolder}
                      depth={depth}
                      reorderMode={reorderMode}
                      onReorderDrop={(position) =>
                        handleReorderDrop(`folder:${item.name}`, position)
                      }
                      onFolderDragStart={() =>
                        setDraggedReorderKey(`folder:${item.name}`)
                      }
                      onFolderDragEnd={() => {
                        setDraggedReorderKey(null);
                        setReorderHoverKey(null);
                        setReorderHoverEdge(null);
                      }}
                      draggedCredentialId={draggedCredentialId}
                      onDropCredential={(credentialId) => {
                        setDraggedCredentialId(null);
                        onMoveCredentialToFolder?.(credentialId, item.name);
                      }}
                      isReorderHovered={
                        reorderHoverKey === `folder:${item.name}`
                      }
                      reorderHoverEdge={reorderHoverEdge}
                      onReorderHoverChange={(edge) => {
                        setReorderHoverKey(edge ? `folder:${item.name}` : null);
                        setReorderHoverEdge(edge);
                      }}
                    />
                  ) : (
                    <CredentialItem
                      cred={item}
                      usedByCount={usedByCounts?.get(item.id) ?? 0}
                      termixIdLinked={termixIdLinkedIds?.has(Number(item.id))}
                      query={query}
                      stripeIndex={vItem.index}
                      isMenuOpen={openMenuCredentialId === item.id}
                      onMenuOpenChange={(open) =>
                        setOpenMenuCredentialId(open ? item.id : null)
                      }
                      isTrayOpen={openTrayCredentialId === item.id}
                      onTrayOpenChange={(open) =>
                        setOpenTrayCredentialId(open ? item.id : null)
                      }
                      onDragStart={() => {
                        if (reorderMode) {
                          setDraggedReorderKey(`cred:${item.id}`);
                        } else {
                          setDraggedCredentialId(item.id);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedReorderKey(null);
                        setDraggedCredentialId(null);
                        setReorderHoverKey(null);
                        setReorderHoverEdge(null);
                      }}
                      depth={depth}
                      density={density}
                      trayTrigger={trayTrigger}
                      showTags={showTags}
                      reorderMode={reorderMode}
                      onReorderDrop={(position) =>
                        handleReorderDrop(`cred:${item.id}`, position)
                      }
                      isReorderHovered={reorderHoverKey === `cred:${item.id}`}
                      reorderHoverEdge={reorderHoverEdge}
                      onReorderHoverChange={(edge) => {
                        setReorderHoverKey(edge ? `cred:${item.id}` : null);
                        setReorderHoverEdge(edge);
                      }}
                      onDeploy={() => onDeployCredential(item)}
                      onEdit={() => onEditCredential(item)}
                      onDelete={() => onDeleteCredential(item)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
