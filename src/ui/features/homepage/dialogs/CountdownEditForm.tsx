import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  CountdownConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function CountdownEditForm({
  config,
  onChange,
}: WidgetEditFormProps<CountdownConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.countdownLabel")}
        </label>
        <Input
          value={config.label}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
          placeholder={t("homepage.countdownLabelPlaceholder")}
          className="h-8 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.targetDate")}
        </label>
        <Input
          type="datetime-local"
          value={config.targetDate}
          onChange={(e) => onChange({ ...config, targetDate: e.target.value })}
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showDays}
          onChange={(e) => onChange({ ...config, showDays: e.target.checked })}
          className="accent-accent-brand"
        />
        {t("homepage.countdownShowDays")}
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showHours}
          onChange={(e) => onChange({ ...config, showHours: e.target.checked })}
          className="accent-accent-brand"
        />
        {t("homepage.countdownShowHours")}
      </label>
    </div>
  );
}
