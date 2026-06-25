import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  RecentActivityConfig,
  ActivityType,
  WidgetEditFormProps,
} from "@/types/homepage-types";

const ALL_TYPES: ActivityType[] = [
  "terminal",
  "file_manager",
  "docker",
  "tunnel",
  "rdp",
  "vnc",
  "telnet",
];

export function RecentActivityEditForm({
  config,
  onChange,
}: WidgetEditFormProps<RecentActivityConfig>) {
  const { t } = useTranslation();

  const toggleType = (type: ActivityType) => {
    const next = config.filterTypes.includes(type)
      ? config.filterTypes.filter((x) => x !== type)
      : [...config.filterTypes, type];
    onChange({ ...config, filterTypes: next });
  };

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

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.filterActivityTypes")}
        </label>
        <div className="flex flex-wrap gap-1">
          {ALL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`px-2 py-0.5 text-[10px] border transition-colors ${
                config.filterTypes.includes(type) ||
                config.filterTypes.length === 0
                  ? "bg-accent-brand border-accent-brand text-white"
                  : "border-border text-muted-foreground"
              }`}
            >
              {type.replace("_", " ")}
            </button>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground">
          {t("homepage.filterTypesHint")}
        </span>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showTimestamp}
          onChange={(e) =>
            onChange({ ...config, showTimestamp: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showTimestamp")}
      </label>
    </div>
  );
}
