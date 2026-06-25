import { useTranslation } from "react-i18next";
import type {
  TermixUptimeConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function TermixUptimeEditForm({
  config,
  onChange,
}: WidgetEditFormProps<TermixUptimeConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showDetailed}
          onChange={(e) =>
            onChange({ ...config, showDetailed: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showSeconds")}
      </label>
    </div>
  );
}
