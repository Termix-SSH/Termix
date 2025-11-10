import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import {
  Folder,
  Server,
  Cloud,
  Database,
  Box,
  Package,
  Layers,
  Archive,
  HardDrive,
  Globe,
} from "lucide-react";

interface FolderEditDialogProps {
  folderName: string;
  currentColor?: string;
  currentIcon?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (color: string, icon: string) => Promise<void>;
}

const AVAILABLE_COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#6b7280", label: "Gray" },
];

const AVAILABLE_ICONS = [
  { value: "Folder", label: "Folder", Icon: Folder },
  { value: "Server", label: "Server", Icon: Server },
  { value: "Cloud", label: "Cloud", Icon: Cloud },
  { value: "Database", label: "Database", Icon: Database },
  { value: "Box", label: "Box", Icon: Box },
  { value: "Package", label: "Package", Icon: Package },
  { value: "Layers", label: "Layers", Icon: Layers },
  { value: "Archive", label: "Archive", Icon: Archive },
  { value: "HardDrive", label: "HardDrive", Icon: HardDrive },
  { value: "Globe", label: "Globe", Icon: Globe },
];

export function FolderEditDialog({
  folderName,
  currentColor,
  currentIcon,
  open,
  onOpenChange,
  onSave,
}: FolderEditDialogProps) {
  const { t } = useTranslation();
  const [selectedColor, setSelectedColor] = useState(
    currentColor || AVAILABLE_COLORS[0].value,
  );
  const [selectedIcon, setSelectedIcon] = useState(
    currentIcon || AVAILABLE_ICONS[0].value,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedColor(currentColor || AVAILABLE_COLORS[0].value);
      setSelectedIcon(currentIcon || AVAILABLE_ICONS[0].value);
    }
  }, [open, currentColor, currentIcon]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave(selectedColor, selectedIcon);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save folder metadata:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-dark-bg border-2 border-dark-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="w-5 h-5" />
            {t("hosts.editFolderAppearance")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("hosts.editFolderAppearanceDesc")}:{" "}
            <span className="font-mono text-foreground">{folderName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Color Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("hosts.folderColor")}
            </Label>
            <div className="grid grid-cols-4 gap-3">
              {AVAILABLE_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`h-12 rounded-md border-2 transition-all hover:scale-105 ${
                    selectedColor === color.value
                      ? "border-white shadow-lg scale-105"
                      : "border-dark-border"
                  }`}
                  style={{ backgroundColor: color.value }}
                  onClick={() => setSelectedColor(color.value)}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Icon Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("hosts.folderIcon")}
            </Label>
            <div className="grid grid-cols-5 gap-3">
              {AVAILABLE_ICONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`h-14 rounded-md border-2 transition-all hover:scale-105 flex items-center justify-center ${
                    selectedIcon === value
                      ? "border-primary bg-primary/10"
                      : "border-dark-border bg-dark-bg-darker"
                  }`}
                  onClick={() => setSelectedIcon(value)}
                  title={label}
                >
                  <Icon className="w-6 h-6" />
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("hosts.preview")}
            </Label>
            <div className="flex items-center gap-3 p-4 rounded-md bg-dark-bg-darker border border-dark-border">
              {(() => {
                const IconComponent =
                  AVAILABLE_ICONS.find((i) => i.value === selectedIcon)?.Icon ||
                  Folder;
                return (
                  <IconComponent
                    className="w-5 h-5"
                    style={{ color: selectedColor }}
                  />
                );
              })()}
              <span className="font-medium">{folderName}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
