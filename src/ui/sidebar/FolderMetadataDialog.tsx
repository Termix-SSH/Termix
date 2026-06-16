import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  DEFAULT_FOLDER_COLOR,
  DEFAULT_FOLDER_ICON,
  FolderIconEl,
  HexColorPicker,
  IconPicker,
} from "@/components/folder-style";
import { normalizePath, splitPath } from "./FolderPathPicker";

export type FolderMetadataValue = {
  name: string;
  color: string;
  icon: string;
};

export function FolderMetadataDialog({
  open,
  mode,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: { name: string; color?: string; icon?: string };
  onOpenChange: (v: boolean) => void;
  onSubmit: (value: FolderMetadataValue) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const [icon, setIcon] = useState(DEFAULT_FOLDER_ICON);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? DEFAULT_FOLDER_COLOR);
      setIcon(initial?.icon ?? DEFAULT_FOLDER_ICON);
    }
  }, [open, initial]);

  function handleSubmit() {
    const normalized = normalizePath(name);
    if (!normalized) return;
    onSubmit({ name: normalized, color, icon });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {mode === "create"
              ? t("hosts.createFolderTitle")
              : t("hosts.editFolderTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("hosts.folderDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("hosts.folderNameLabel")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              placeholder={t("hosts.folderNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.folderNestingHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              {t("hosts.folderColor")}
            </label>
            <HexColorPicker value={color} onChange={setColor} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              {t("hosts.folderIcon")}
            </label>
            <IconPicker value={icon} color={color} onChange={setIcon} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("hosts.folderPreview")}
            </label>
            <div className="flex items-center gap-2 px-3 py-3 border border-border bg-muted/20">
              <FolderIconEl
                icon={icon}
                className="size-4 shrink-0"
                style={{ color }}
              />
              <span className="flex items-center gap-0.5 text-sm font-semibold flex-wrap">
                {name
                  ? splitPath(name).map((seg, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                        )}
                        {seg}
                      </span>
                    ))
                  : t("hosts.folderNameFallback")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("hosts.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleSubmit}
          >
            {mode === "create"
              ? t("hosts.createFolderButton")
              : t("hosts.saveFolderButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
