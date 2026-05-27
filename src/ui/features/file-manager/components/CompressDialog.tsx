import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog.tsx";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Label } from "@/components/label.tsx";
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CompressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileNames: string[];
  onCompress: (archiveName: string, format: string) => void;
}

export function CompressDialog({
  open,
  onOpenChange,
  fileNames,
  onCompress,
}: CompressDialogProps) {
  const { t } = useTranslation();
  const [archiveName, setArchiveName] = useState("");
  const [format, setFormat] = useState("zip");

  useEffect(() => {
    if (open && fileNames.length > 0) {
      if (fileNames.length === 1) {
        const baseName = fileNames[0].replace(/\.[^/.]+$/, "");
        setArchiveName(baseName);
      } else {
        setArchiveName("archive");
      }
    }
  }, [open, fileNames]);

  const handleCompress = () => {
    if (!archiveName.trim()) return;

    let finalName = archiveName.trim();
    const extensions: Record<string, string> = {
      zip: ".zip",
      "tar.gz": ".tar.gz",
      "tar.bz2": ".tar.bz2",
      "tar.xz": ".tar.xz",
      tar: ".tar",
      "7z": ".7z",
    };

    const expectedExtension = extensions[format];
    if (expectedExtension && !finalName.endsWith(expectedExtension)) {
      finalName += expectedExtension;
    }

    onCompress(finalName, format);
    onOpenChange(false);
  };

  const formats = ["zip", "tar.gz", "tar.bz2", "tar.xz", "tar", "7z"] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-none border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Package className="size-4 text-accent-brand" />
            {t("fileManager.compressFiles")}
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
            {t("fileManager.compressFilesDesc", { count: fileNames.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label
              className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
              htmlFor="archiveName"
            >
              {t("fileManager.archiveName")}
            </Label>
            <Input
              id="archiveName"
              value={archiveName}
              onChange={(e) => setArchiveName(e.target.value)}
              placeholder={t("fileManager.enterArchiveName")}
              className="rounded-none bg-muted/50 border-border text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCompress();
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t("fileManager.compressionFormat")}
            </Label>
            <div className="grid grid-cols-3 gap-1">
              {formats.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`py-2 text-xs font-bold uppercase tracking-widest border transition-colors ${
                    format === f
                      ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  .{f}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-none bg-muted/10 border border-border p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {t("fileManager.selectedFiles")}:
            </p>
            <ul className="text-xs space-y-1">
              {fileNames.slice(0, 5).map((name, index) => (
                <li
                  key={index}
                  className="truncate text-foreground font-medium"
                >
                  • {name}
                </li>
              ))}
              {fileNames.length > 5 && (
                <li className="text-muted-foreground">
                  {t("fileManager.andMoreFiles", {
                    count: fileNames.length - 5,
                  })}
                </li>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={handleCompress}
            disabled={!archiveName.trim()}
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            <Package className="size-3.5 mr-1" />
            {t("fileManager.compress")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
