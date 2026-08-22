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
import { reorderCredentials } from "@/main-axios";
import { planReorder, renumberSiblings } from "@/sidebar/reorder-utils";
import { ReorderIndicator } from "@/sidebar/ReorderIndicator";
import type { Credential } from "@/types/ui-types";
import type {
  CredentialDensity,
  CredentialTrayTrigger,
} from "@/types/credential-sidebar-preferences";
import { CredentialItem } from "./CredentialItem/CredentialItem";
import { getCredentialRowHeight } from "./credential-row-height";
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
  onCloneCredential,
  onDeleteCredential,
  usedByCounts,
  termixIdLinkedIds,
  query = "",
  loading = false,
  arrangeLocked = true,
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
  onCloneCredential: (cred: Credential) => void;
  onDeleteCredential: (cred: Credential) => void;
  usedByCounts?: Map<string, number>;
  termixIdLinkedIds?: Set<number>;
  query?: string;
  loading?: boolean;
  /** When true, drag-to-rearrange is off entirely. Toggled from the panel header. */
  arrangeLocked?: boolean;
  density?: CredentialDensity;
  trayTrigger?: CredentialTrayTrigger;
  showTags?: boolean;
  editingFolderName: string | null;
  editingFolderValue: string;
  onEditingFolderNameChange: (name: string | null) => void;
  onEditingFolderValueChange: (value: string) => void;
  onRenameFolder: (folder: string, newName: string) => Promise<void>;
  onDeleteFolder?: (folder: string) => void;
  /** Drop a credential on a folder header to reassign it. */
  onMoveCredentialToFolder?: (
    credentialId: string,
    targetFolder: string,
  ) => void | Promise<void>;
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
  const arrangeMode = !arrangeLocked;

  const isTouchOnly =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const alwaysShowActions = trayTrigger === "always";
  const actionsOnly = trayTrigger === "actionsOnly";
  const clickTrayActive =
    !alwaysShowActions &&
    !actionsOnly &&
    (trayTrigger === "click" || isTouchOnly);
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
  const rowHeight = useCallback(
    (index: number) => {
      const row = visibleRows[index];
      if (!row) return FOLDER_ROW_HEIGHT;
      if (isFolder(row.item)) return FOLDER_ROW_HEIGHT;
      const isKey = row.item.type === "key";
      const isOpen =
        (openTrayCredentialId === row.item.id ||
          openMenuCredentialId === row.item.id) &&
        (clickTrayActive || actionsOnly);
      return getCredentialRowHeight({
        density,
        isKey,
        alwaysShowActions,
        actionsOnly,
        isOpen,
        showTags,
        tagCount: row.item.tags?.length ?? 0,
      });
    },
    [
      visibleRows,
      openTrayCredentialId,
      openMenuCredentialId,
      clickTrayActive,
      alwaysShowActions,
      actionsOnly,
      density,
      showTags,
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

  // Single tree-level indicator off the virtualizer's slot geometry -- see
  // SidebarTree for why rows can't place this themselves.
  const reorderIndicatorTop = (() => {
    if (!arrangeMode || !reorderHoverKey || !reorderHoverEdge) return null;
    const index = visibleRows.findIndex((row) => {
      const key = isFolder(row.item)
        ? `folder:${row.item.name}`
        : `cred:${row.item.id}`;
      return key === reorderHoverKey;
    });
    if (index === -1) return null;
    const slot = virtualizer
      .getVirtualItems()
      .find((vItem) => vItem.index === index);
    if (!slot) return null;
    return reorderHoverEdge === "before" ? slot.start : slot.start + slot.size;
  })();

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
    showTags,
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
   * Resolves a credential drop into its new position, scoped to the target
   * credential's own folder, and moves it there when the drop crossed
   * folders. Credential folders themselves are always alphabetical -- they
   * have no stored order, so only credentials are draggable.
   */
  /**
   * Credential dropped on a folder header: lands at the end of that folder.
   * It needs an explicit sortOrder for the same reason hosts do -- a null
   * one sorts last under manual sort and then falls back to alphabetical,
   * throwing the placement away.
   */
  async function handleDropIntoFolder(credentialId: string, folder: string) {
    const destination = folders
      .find((f) => f.name === folder)
      ?.children.filter((c) => c.id !== credentialId);
    try {
      await onMoveCredentialToFolder?.(credentialId, folder);
      if (destination) {
        const ordered = [
          ...destination.filter((c) => c.sortOrder != null),
          ...destination.filter((c) => c.sortOrder == null),
        ];
        await reorderCredentials(
          renumberSiblings([...ordered, { id: credentialId }]).map((r) => ({
            id: Number(r.id),
            sortOrder: r.sortOrder,
          })),
        );
      }
      window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
    } catch {
      toast.error(t("credentials.failedToReorder"));
    }
  }

  async function handleReorderDrop(
    targetKey: string,
    position: "before" | "after",
  ) {
    const draggedKey = draggedReorderKey;
    setDraggedReorderKey(null);
    setReorderHoverKey(null);
    setReorderHoverEdge(null);
    if (!draggedKey) return;
    if (!draggedKey.startsWith("cred:") || !targetKey.startsWith("cred:"))
      return;

    // From every folder's children, not visibleRows: a collapsed folder
    // contributes no visible rows, so planning off the rendered list
    // compared against a partial sibling group.
    const rows = folders.flatMap((folder) =>
      folder.children.map((cred) => ({
        key: `cred:${cred.id}`,
        parentKey: `folder:${cred.folder || "Uncategorized"}`,
        sortOrder: cred.sortOrder,
      })),
    );

    const plan = planReorder(rows, draggedKey, targetKey, position);
    if (!plan) return;

    const draggedId = draggedKey.slice("cred:".length);

    try {
      if (plan.movedTo !== null) {
        const folder = plan.movedTo.slice("folder:".length);
        await onMoveCredentialToFolder?.(draggedId, folder);
      }
      await reorderCredentials(
        plan.positions.map((pos) => ({
          id: Number(pos.key.slice("cred:".length)),
          sortOrder: pos.sortOrder,
        })),
      );
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
            {reorderIndicatorTop !== null && (
              <ReorderIndicator top={reorderIndicatorTop} />
            )}
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
                      arrangeMode={arrangeMode}
                      draggedCredentialId={draggedCredentialId}
                      onDropCredential={(credentialId) => {
                        setDraggedCredentialId(null);
                        void handleDropIntoFolder(credentialId, item.name);
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
                        // Both arm together: the drop target picks whether
                        // this ends up a reorder or a folder move.
                        setDraggedReorderKey(`cred:${item.id}`);
                        setDraggedCredentialId(item.id);
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
                      arrangeMode={arrangeMode}
                      isDragging={draggedReorderKey === `cred:${item.id}`}
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
                      onClone={() => onCloneCredential(item)}
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
