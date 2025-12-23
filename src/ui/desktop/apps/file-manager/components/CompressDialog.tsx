import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
        <DialogHeader>
          <DialogTitle>{t("fileManager.compressFiles")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("fileManager.compressFilesDesc", { count: fileNames.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label
              className="text-base font-semibold text-foreground"
              htmlFor="archiveName"
            >
              {t("fileManager.archiveName")}
            </Label>
            <Input
              id="archiveName"
              value={archiveName}
              onChange={(e) => setArchiveName(e.target.value)}
              placeholder={t("fileManager.enterArchiveName")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCompress();
                }
              }}
            />
          </div>

          <div className="space-y-3">
            <Label
              className="text-base font-semibold text-foreground"
              htmlFor="format"
            >
              {t("fileManager.compressionFormat")}
            </Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger id="format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">ZIP (.zip)</SelectItem>
                <SelectItem value="tar.gz">TAR.GZ (.tar.gz)</SelectItem>
                <SelectItem value="tar.bz2">TAR.BZ2 (.tar.bz2)</SelectItem>
                <SelectItem value="tar.xz">TAR.XZ (.tar.xz)</SelectItem>
                <SelectItem value="tar">TAR (.tar)</SelectItem>
                <SelectItem value="7z">7-Zip (.7z)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md bg-hover/50 border border-edge p-3">
            <p className="text-sm text-muted-foreground mb-2">
              {t("fileManager.selectedFiles")}:
            </p>
            <ul className="text-sm space-y-1">
              {fileNames.slice(0, 5).map((name, index) => (
                <li key={index} className="truncate text-foreground">
                  • {name}
                </li>
              ))}
              {fileNames.length > 5 && (
                <li className="text-muted-foreground italic">
                  {t("fileManager.andMoreFiles", {
                    count: fileNames.length - 5,
                  })}
                </li>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCompress} disabled={!archiveName.trim()}>
            {t("fileManager.compress")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
