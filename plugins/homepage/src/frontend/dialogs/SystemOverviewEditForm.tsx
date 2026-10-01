import { useTranslation } from "@termix/plugin-sdk/frontend";
import type { SystemOverviewConfig, WidgetEditFormProps } from "../types.js";

export function SystemOverviewEditForm({
  config,
  onChange,
}: WidgetEditFormProps<SystemOverviewConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showVersion}
          onChange={(e) =>
            onChange({ ...config, showVersion: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.overviewVersion")}
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showDbHealth}
          onChange={(e) =>
            onChange({ ...config, showDbHealth: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.overviewDatabase")}
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showUptime}
          onChange={(e) =>
            onChange({ ...config, showUptime: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.overviewUptime")}
      </label>
    </div>
  );
}
