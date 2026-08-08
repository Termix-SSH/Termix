import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type { CredentialFolder } from "../visible-rows";

const UNCATEGORIZED = "Uncategorized";

export function CredentialFolderItem({
  folder,
  isOpen,
  stripeIndex,
  query = "",
  editingFolderName,
  editingFolderValue,
  onToggleFolder,
  onEditingFolderNameChange,
  onEditingFolderValueChange,
  onRenameFolder,
  onDeleteFolder,
  depth = 0,
  reorderMode = false,
  onReorderDrop,
  onFolderDragStart,
  onFolderDragEnd,
  draggedCredentialId,
  onDropCredential,
  isReorderHovered = false,
  reorderHoverEdge = null,
  onReorderHoverChange,
}: {
  folder: CredentialFolder;
  isOpen: boolean;
  stripeIndex?: number;
  query?: string;
  editingFolderName: string | null;
  editingFolderValue: string;
  onToggleFolder: (name: string) => void;
  onEditingFolderNameChange: (name: string | null) => void;
  onEditingFolderValueChange: (value: string) => void;
  onRenameFolder: (folder: string, newName: string) => Promise<void>;
  onDeleteFolder?: (folder: string) => void;
  depth?: number;
  reorderMode?: boolean;
  onReorderDrop?: (position: "before" | "after") => void;
  onFolderDragStart?: () => void;
  onFolderDragEnd?: () => void;
  /** Id of the credential currently being dragged (outside manual sort
   * mode), if any -- drives the drop-target highlight below. */
  draggedCredentialId?: string | null;
  /** Fires when a dragged credential is dropped on this folder header to
   * reassign it, outside manual sort mode. */
  onDropCredential?: (credentialId: string) => void;
  /** Whether THIS folder header is the current reorder drop target -- see
   * HostItem's identical prop for why this is lifted rather than local. */
  isReorderHovered?: boolean;
  reorderHoverEdge?: "before" | "after" | null;
  onReorderHoverChange?: (edge: "before" | "after" | null) => void;
}) {
  const { t } = useTranslation();
  const reorderEdge = isReorderHovered ? reorderHoverEdge : null;
  const [dragOver, setDragOver] = useState(false);
  const isRenaming = editingFolderName === folder.name;
  const canManage = folder.name !== UNCATEGORIZED;
  const actionButtonClass =
    "flex items-center justify-center size-6 text-muted-foreground/60 hover:text-foreground hover:bg-background/80 transition-colors";

  return (
    <div
      className="relative"
      style={depth > 0 ? { paddingLeft: depth * 12 } : undefined}
      onDragOver={(e) => {
        if (reorderMode && onReorderDrop) {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onReorderHoverChange?.(
            e.clientY - rect.top < rect.height / 2 ? "before" : "after",
          );
          return;
        }
        if (!reorderMode && draggedCredentialId) {
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
        if (reorderMode && onReorderDrop && reorderEdge) {
          e.preventDefault();
          e.stopPropagation();
          onReorderDrop(reorderEdge);
          onReorderHoverChange?.(null);
          return;
        }
        if (!reorderMode && draggedCredentialId) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          onDropCredential?.(draggedCredentialId);
        }
      }}
    >
      {reorderMode && reorderEdge && (
        <div
          className={`absolute inset-x-0 h-0.5 bg-accent-brand pointer-events-none z-10 ${reorderEdge === "before" ? "top-0" : "bottom-0"}`}
        />
      )}
      <div
        draggable={reorderMode && canManage}
        onDragStart={(e) => {
          if (!reorderMode || !canManage) return;
          e.dataTransfer.effectAllowed = "move";
          onFolderDragStart?.();
        }}
        onDragEnd={() => onFolderDragEnd?.()}
        onClick={() => !query && !isRenaming && onToggleFolder(folder.name)}
        className={`group/folder flex items-center gap-2 w-full pl-2.5 pr-2 py-1.5 transition-colors text-left cursor-pointer ${
          isOpen ? "bg-muted/40" : "hover:bg-muted/30"
        } ${(stripeIndex ?? 0) % 2 === 1 && !isOpen ? "bg-muted/[0.08]" : ""} ${dragOver ? "ring-1 ring-inset ring-accent-brand bg-accent-brand/10" : ""}`}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
        {isOpen ? (
          <FolderOpen className="size-4 shrink-0 text-accent-brand" />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground/70" />
        )}
        {isRenaming ? (
          <>
            <input
              autoFocus
              value={editingFolderValue}
              onChange={(e) => onEditingFolderValueChange(e.target.value)}
              onBlur={async () => {
                const newName = editingFolderValue.trim();
                onEditingFolderNameChange(null);
                if (newName && newName !== folder.name) {
                  await onRenameFolder(folder.name, newName);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") onEditingFolderNameChange(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-[13px] font-bold bg-background border border-accent-brand/60 px-1 outline-none text-foreground min-w-0 flex-1"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditingFolderNameChange(null);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-3" />
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[13px] font-bold text-foreground tracking-tight">
                {folder.name}
              </span>
            </span>
            <span className="text-[10px] tabular-nums shrink-0 ml-1 px-1.5 py-[1px] bg-muted/70 text-muted-foreground/50">
              {folder.children.length}
            </span>
            {canManage && (
              <span className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
                <button
                  type="button"
                  title={t("credentials.renameFolder")}
                  className={actionButtonClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditingFolderNameChange(folder.name);
                    onEditingFolderValueChange(folder.name);
                  }}
                >
                  <Pencil className="size-3" />
                </button>
                {onDeleteFolder && (
                  <button
                    type="button"
                    title={t("credentials.deleteFolder")}
                    className={`${actionButtonClass} hover:text-destructive`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFolder(folder.name);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
