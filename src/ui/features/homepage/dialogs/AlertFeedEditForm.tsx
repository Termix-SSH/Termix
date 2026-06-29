import { useTranslation } from "react-i18next";
import type {
  AlertFeedConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { Input } from "@/components/input";

export function AlertFeedEditForm({
  config,
  onChange,
}: WidgetEditFormProps<AlertFeedConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
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
              maxItems: Math.max(1, Number(e.target.value)),
            })
          }
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showAcknowledged}
          onChange={(e) =>
            onChange({ ...config, showAcknowledged: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showAcknowledged")}
      </label>
    </div>
  );
}
