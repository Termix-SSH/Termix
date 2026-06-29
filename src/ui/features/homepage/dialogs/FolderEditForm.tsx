import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type { FolderConfig, WidgetEditFormProps } from "@/types/homepage-types";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

export function FolderEditForm({
  config,
  onChange,
}: WidgetEditFormProps<FolderConfig>) {
  const { t } = useTranslation();
  const accent = getAccentColor();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.color")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.color || accent}
            onChange={(e) => onChange({ ...config, color: e.target.value })}
            className="w-8 h-8 border border-border cursor-pointer"
          />
          <Input
            value={config.color ?? ""}
            onChange={(e) =>
              onChange({ ...config, color: e.target.value || undefined })
            }
            placeholder={accent}
            className="h-8 text-sm flex-1"
          />
        </div>
      </div>
    </div>
  );
}
