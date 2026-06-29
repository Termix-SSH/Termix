import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  DockerActivityConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function DockerActivityEditForm({
  config,
  onChange,
}: WidgetEditFormProps<DockerActivityConfig>) {
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
          checked={config.showHostName}
          onChange={(e) =>
            onChange({ ...config, showHostName: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showHostName")}
      </label>
    </div>
  );
}
