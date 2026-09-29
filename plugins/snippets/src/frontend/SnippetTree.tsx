import { useState, type ReactNode } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Share2,
  StickyNote,
  Terminal,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@termix/plugin-sdk/ui";
import { FolderIcon } from "./folder-icons";
import type { Snippet, SnippetFolder } from "./types";

const trayButtonClass =
  "flex items-center justify-center size-[22.75px] text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors";

export type DropPosition = "above" | "below";

export function SnippetRow({
  snippet,
  stripeIndex,
  showCommand,
  folderNames,
  targetHostNames,
  canEdit,
  canDelete,
  canShare,
  draggable,
  dragActive,
  isDragging,
  dropIndicator,
  onRun,
  onCopy,
  onEdit,
  onShare,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDropRow,
}: {
  snippet: Snippet;
  stripeIndex: number;
  showCommand: boolean;
  folderNames: string[];
  /** Hosts a command snippet runs on directly, instead of the active terminal. */
  targetHostNames: string[];
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  draggable: boolean;
  /** True while any snippet is being dragged, so this row is a drop target. */
  dragActive: boolean;
  isDragging: boolean;
  dropIndicator: DropPosition | null;
  onRun: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onShare: () => void;
  onMove: (folder: string | null) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: (position: DropPosition) => void;
  onDropRow: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const owned = !snippet.isShared;
  const editable = canEdit && owned;
  const deletable = canDelete && owned;
  const shareable = canShare && owned;
  const hasTargets = !snippet.isNote && targetHostNames.length > 0;
  const TypeIcon = snippet.isNote ? StickyNote : Terminal;
  const RunIcon = hasTargets ? Zap : snippet.isNote ? ClipboardPaste : Play;
  const runLabel = t(
    hasTargets ? "runOnTargets" : snippet.isNote ? "pasteToTerminal" : "run",
  );

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!dragActive) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverRow(
          e.clientY < rect.top + rect.height / 2 ? "above" : "below",
        );
      }}
      onDrop={(e) => {
        if (!dragActive) return;
        e.preventDefault();
        e.stopPropagation();
        onDropRow();
      }}
      onDoubleClick={onRun}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      title={t("doubleClickToRun")}
      className={`group relative flex items-stretch select-none border-b border-border/40 transition-colors hover:bg-muted/50 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        menuOpen ? "bg-muted/50" : stripeIndex % 2 === 1 ? "bg-muted/15" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {dropIndicator && (
        <div
          className={`absolute left-0 right-0 h-0.5 bg-accent-brand z-10 pointer-events-none ${dropIndicator === "above" ? "-top-px" : "-bottom-px"}`}
        />
      )}
      <div
        className={`w-[3px] shrink-0 ${snippet.isNote ? "bg-muted-foreground/30" : "bg-accent-brand/60"}`}
      />
      {draggable && (
        <div className="flex items-center justify-center w-3.5 shrink-0 -mr-1.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors">
          <GripVertical className="size-3" />
        </div>
      )}
      <div className="flex flex-col flex-1 min-w-0 pl-[8.75px] pr-[7px] py-[7px] gap-[3.5px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <TypeIcon className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="text-[13px] font-semibold truncate text-foreground leading-none tracking-tight">
            {snippet.name}
          </span>
          {snippet.isNote && (
            <span className="text-[9px] px-1 py-px border border-border bg-muted/40 text-muted-foreground shrink-0 leading-none uppercase tracking-wider">
              {t("typeNote")}
            </span>
          )}
          {snippet.isShared && (
            <span className="flex items-center gap-0.5 text-[9px] px-1 py-px border border-accent-brand/30 bg-accent-brand/10 text-accent-brand shrink-0 leading-none uppercase tracking-wider">
              <Users className="size-2.5" />
              {t("sharedBadge")}
            </span>
          )}
        </div>
        {snippet.description && (
          <span className="text-[11px] text-muted-foreground/80 truncate leading-tight">
            {snippet.description}
          </span>
        )}
        {showCommand && (
          <span className="text-[11px] text-muted-foreground/60 truncate leading-tight font-mono">
            {snippet.content.split("\n")[0]}
          </span>
        )}
        {hasTargets && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            <Zap className="size-2.5 shrink-0 text-accent-brand/70" />
            {targetHostNames.slice(0, 3).map((name) => (
              <span
                key={name}
                className="text-[9px] px-1.5 py-[1px] bg-accent-brand/10 text-accent-brand shrink-0 leading-[1.4] truncate max-w-28"
              >
                {name}
              </span>
            ))}
            {targetHostNames.length > 3 && (
              <span className="text-[9px] text-muted-foreground/50 shrink-0">
                +{targetHostNames.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className={`absolute right-1.5 top-1.5 items-center border border-border bg-background shadow-sm ${
          menuOpen ? "flex" : "hidden group-hover:flex pointer-coarse:flex"
        }`}
      >
        <button
          title={runLabel}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          className={`${trayButtonClass} text-accent-brand/80 hover:text-accent-brand`}
        >
          <RunIcon className="size-3.5" />
        </button>
        <button
          title={t("copyToClipboard")}
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className={trayButtonClass}
        >
          <Copy className="size-3.5" />
        </button>
        {editable && (
          <button
            title={t("editSnippetTitle")}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className={trayButtonClass}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        {shareable && (
          <button
            title={t("shareSnippet")}
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className={trayButtonClass}
          >
            <Share2 className="size-3.5" />
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              title={t("moreOptions")}
              onClick={(e) => e.stopPropagation()}
              className={trayButtonClass}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs min-w-44">
            <DropdownMenuItem onClick={onRun}>
              <RunIcon className="size-3.5 mr-2" />
              {runLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopy}>
              <Copy className="size-3.5 mr-2" />
              {t("copyToClipboard")}
            </DropdownMenuItem>
            {editable && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-3.5 mr-2" />
                {t("editSnippetTitle")}
              </DropdownMenuItem>
            )}
            {shareable && (
              <DropdownMenuItem onClick={onShare}>
                <Share2 className="size-3.5 mr-2" />
                {t("shareSnippet")}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="size-3.5 mr-2" />
                  {t("moveToFolder")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="text-xs max-w-72">
                  <DropdownMenuItem
                    disabled={!snippet.folder}
                    onClick={() => onMove(null)}
                  >
                    {t("noFolder")}
                  </DropdownMenuItem>
                  {folderNames.map((name) => (
                    <DropdownMenuItem
                      key={name}
                      disabled={snippet.folder === name}
                      onClick={() => onMove(name)}
                    >
                      <span className="truncate">{name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {deletable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-3.5 mr-2" />
                  {t("deleteSnippet")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function SnippetFolderRow({
  name,
  folder,
  count,
  open,
  stripeIndex,
  canCreate,
  canEdit,
  canDelete,
  canShare,
  acceptsDrop,
  onToggle,
  onAddSnippet,
  onEdit,
  onShare,
  onDelete,
  onDropSnippet,
  children,
}: {
  name: string;
  /** Null for a folder that only exists as a name on its snippets. */
  folder: SnippetFolder | null;
  count: number;
  open: boolean;
  stripeIndex: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  /** True while a snippet is being dragged that could move into this folder. */
  acceptsDrop: boolean;
  onToggle: () => void;
  onAddSnippet: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
  onDropSnippet: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const hasActions = canCreate || canEdit || canDelete || canShare;

  return (
    <div className="border-b border-border/40">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        onDragOver={(e) => {
          if (!acceptsDrop) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          if (!acceptsDrop) return;
          e.preventDefault();
          setDragOver(false);
          onDropSnippet();
        }}
        className={`group/folder flex items-center gap-2 w-full pl-2.5 pr-2 py-1.5 cursor-pointer select-none transition-colors ${
          open ? "bg-muted/40" : "hover:bg-muted/30"
        } ${stripeIndex % 2 === 1 && !open ? "bg-muted/[0.08]" : ""} ${
          dragOver && acceptsDrop
            ? "ring-1 ring-inset ring-accent-brand bg-accent-brand/10"
            : ""
        }`}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <FolderIcon
          icon={folder?.icon}
          className={`size-4 shrink-0 ${folder?.color ? "" : open ? "text-accent-brand" : "text-muted-foreground/70"}`}
          style={folder?.color ? { color: folder.color } : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground tracking-tight">
          {name}
        </span>
        <span className="text-[10px] tabular-nums shrink-0 px-1.5 py-[1px] bg-muted/70 text-muted-foreground/70">
          {count}
        </span>
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title={t("folderActions")}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center size-5 shrink-0 text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-0 group-hover/folder:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs min-w-40">
              {canCreate && (
                <DropdownMenuItem onClick={onAddSnippet}>
                  <Plus className="size-3.5 mr-2" />
                  {t("addSnippetHere")}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-3.5 mr-2" />
                  {t("editFolderTitle")}
                </DropdownMenuItem>
              )}
              {canShare && count > 0 && (
                <DropdownMenuItem onClick={onShare}>
                  <Share2 className="size-3.5 mr-2" />
                  {t("shareFolder")}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3.5 mr-2" />
                    {t("deleteFolder")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && (
        <div className="border-l border-border/50 ml-[27px] border-t border-t-border/40 [&>*:last-child]:border-b-0">
          {count === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/60">
              {t("noSnippetsInFolder")}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}
