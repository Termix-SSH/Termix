import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  CalendarConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function CalendarEditForm({
  config,
  onChange,
}: WidgetEditFormProps<CalendarConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.timezone")}
        </label>
        <Input
          value={config.timezone ?? ""}
          onChange={(e) =>
            onChange({ ...config, timezone: e.target.value || undefined })
          }
          placeholder="UTC"
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.startOnMonday}
          onChange={(e) =>
            onChange({ ...config, startOnMonday: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.startOnMonday")}
      </label>
    </div>
  );
}
