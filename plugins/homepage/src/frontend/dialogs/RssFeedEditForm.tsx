import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Input, Switch } from "@termix/plugin-sdk/ui";

import type { RssFeedConfig, WidgetEditFormProps } from "../types.js";

export function RssFeedEditForm({
  config,
  onChange,
}: WidgetEditFormProps<RssFeedConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.feedUrl")}
        </label>
        <Input
          value={config.feedUrl}
          onChange={(e) => onChange({ ...config, feedUrl: e.target.value })}
          placeholder="https://example.com/feed.xml"
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.maxItems")}
        </label>
        <Input
          type="number"
          min={1}
          max={50}
          value={config.maxItems}
          onChange={(e) =>
            onChange({
              ...config,
              maxItems: Math.max(1, Math.min(50, Number(e.target.value))),
            })
          }
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("homepage.showDescription")}
        </label>
        <Switch
          checked={config.showDescription}
          onCheckedChange={(v) => onChange({ ...config, showDescription: v })}
        />
      </div>
    </div>
  );
}
