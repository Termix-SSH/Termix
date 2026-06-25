import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
import type { IframeConfig, WidgetEditFormProps } from "@/types/homepage-types";

export function IframeEditForm({
  config,
  onChange,
}: WidgetEditFormProps<IframeConfig>) {
  const { t } = useTranslation();
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
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.scrolling")}
        </label>
        <Switch
          checked={config.scrolling}
          onCheckedChange={(v) => onChange({ ...config, scrolling: v })}
        />
      </div>
    </div>
  );
}
