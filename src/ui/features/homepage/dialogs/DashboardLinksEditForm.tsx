import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  DashboardLinksConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function DashboardLinksEditForm({
  config,
  onChange,
}: WidgetEditFormProps<DashboardLinksConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.columns")}
        </label>
        <div className="flex gap-1">
          {([1, 2, 3] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...config, columns: c })}
              className={`px-3 py-0.5 text-[10px] border transition-colors ${config.columns === c ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.maxItems")}
        </label>
        <Input
          type="number"
          min={1}
          max={100}
          value={config.maxItems ?? ""}
          onChange={(e) =>
            onChange({
              ...config,
              maxItems: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder={t("homepage.noLimit")}
          className="h-8 text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showIcons}
          onChange={(e) => onChange({ ...config, showIcons: e.target.checked })}
          className="accent-accent-brand"
        />
        {t("homepage.showImage")}
      </label>
    </div>
  );
}
