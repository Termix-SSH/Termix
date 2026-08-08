import { useTranslation } from "react-i18next";
import { FolderOpen, Pencil, Share2, Trash2 } from "lucide-react";
import type { HostFolder } from "@/types/ui-types";

export function FolderActions({
  folder,
  onOpenAllSessions,
  onShareFolder,
  onManageFolder,
  onDeleteFolder,
}: {
  folder: HostFolder;
  onOpenAllSessions: (folder: HostFolder) => void;
  onShareFolder?: (folder: HostFolder) => void;
  onManageFolder: (folder: HostFolder) => void;
  onDeleteFolder: (folder: HostFolder) => void;
}) {
  const { t } = useTranslation();
  const actionButtonClass =
    "flex items-center justify-center size-6 text-muted-foreground/60 hover:text-foreground hover:bg-background/80 transition-colors";
  return (
    <span className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
      <button
        type="button"
        title={t("hosts.openAllSessions")}
        className={actionButtonClass}
        onClick={(e) => {
          e.stopPropagation();
          onOpenAllSessions(folder);
        }}
      >
        <FolderOpen className="size-3" />
      </button>
      {onShareFolder && (
        <button
          type="button"
          title={t("hosts.shareFolder")}
          className={actionButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            onShareFolder(folder);
          }}
        >
          <Share2 className="size-3" />
        </button>
      )}
      <button
        type="button"
        title={t("hosts.editFolder")}
        className={actionButtonClass}
        onClick={(e) => {
          e.stopPropagation();
          onManageFolder(folder);
        }}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        title={t("hosts.deleteFolder")}
        className={`${actionButtonClass} hover:text-destructive`}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteFolder(folder);
        }}
      >
        <Trash2 className="size-3" />
      </button>
    </span>
  );
}
