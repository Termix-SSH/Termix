import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
import type {
  ServiceLinkConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

export function ServiceLinkEditForm({
  config,
  onChange,
}: WidgetEditFormProps<ServiceLinkConfig>) {
  const { t } = useTranslation();
  const accent = getAccentColor();
  const showImage = config.showImage ?? true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.url")}
        </label>
        <Input
          value={config.url}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
          placeholder="https://example.com"
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.description")}
        </label>
        <Input
          value={config.description ?? ""}
          onChange={(e) => onChange({ ...config, description: e.target.value })}
          placeholder="My service"
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.showImage")}
        </label>
        <Switch
          checked={showImage}
          onCheckedChange={(v) => onChange({ ...config, showImage: v })}
        />
      </div>
      {showImage && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("homepage.imageUrl")}
          </label>
          <Input
            value={config.imageUrl ?? ""}
            onChange={(e) =>
              onChange({ ...config, imageUrl: e.target.value || undefined })
            }
            placeholder="https://example.com/logo.png"
            className="h-8 text-sm"
          />
          <span className="text-[10px] text-muted-foreground/60">
            {t("homepage.imageUrlHint")}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.color")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.accentColor || accent}
            onChange={(e) =>
              onChange({ ...config, accentColor: e.target.value })
            }
            className="w-8 h-8 border border-border cursor-pointer"
          />
          <Input
            value={config.accentColor ?? ""}
            onChange={(e) =>
              onChange({ ...config, accentColor: e.target.value || undefined })
            }
            placeholder={accent}
            className="h-8 text-sm flex-1"
          />
        </div>
      </div>
    </div>
  );
}
