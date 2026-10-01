import { useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FOLDER_COLORS,
  Input,
} from "@termix/plugin-sdk/ui";
import { FolderIcon } from "./folder-icons";
import { FOLDER_ICONS, type FolderIconId, type SnippetFolder } from "./types";

export interface FolderFormValues {
  name: string;
  color: string;
  icon: FolderIconId;
}

export function SnippetFolderDialog({
  folder,
  onClose,
  onSave,
}: {
  /** The folder being edited, or null to create one. */
  folder: SnippetFolder | null;
  onClose: () => void;
  onSave: (values: FolderFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState<string>(folder?.color ?? FOLDER_COLORS[0]);
  const [icon, setIcon] = useState<FolderIconId>(
    (folder?.icon as FolderIconId) ?? "folder",
  );
  const [saving, setSaving] = useState(false);

  const isEdit = folder !== null;

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color, icon });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t(isEdit ? "editFolderTitle" : "createFolderTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t(isEdit ? "editFolderDescription" : "createFolderDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("folderNameLabel")}
            </label>
            <Input
              autoFocus
              value={name}
              placeholder={t("folderNamePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("folderColorLabel")}
            </label>
            <div className="grid grid-cols-8 gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  className={`h-7 transition-all ${color === c ? "ring-2 ring-offset-2 ring-offset-background ring-foreground/50" : "opacity-75 hover:opacity-100"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("folderIconLabel")}
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {FOLDER_ICONS.map((id) => (
                <button
                  key={id}
                  type="button"
                  title={id}
                  onClick={() => setIcon(id)}
                  className={`flex items-center justify-center h-9 border transition-colors ${
                    icon === id
                      ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                  }`}
                >
                  <FolderIcon icon={id} className="size-4" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-2 border border-border bg-muted/20">
            <FolderIcon icon={icon} className="size-4" style={{ color }} />
            <span className="text-[13px] font-bold tracking-tight truncate">
              {name.trim() || t("folderNamePlaceholder")}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            disabled={saving || !name.trim()}
            onClick={() => void handleSave()}
          >
            {t(isEdit ? "saveFolderButton" : "createFolderButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
