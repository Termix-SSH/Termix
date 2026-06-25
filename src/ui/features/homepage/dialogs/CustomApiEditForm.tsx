import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  CustomApiConfig,
  CustomApiDisplayMode,
  WidgetEditFormProps,
} from "@/types/homepage-types";

const MODES: { id: CustomApiDisplayMode; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "json", label: "JSON" },
  { id: "table", label: "Table" },
];

export function CustomApiEditForm({
  config,
  onChange,
}: WidgetEditFormProps<CustomApiConfig>) {
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
          placeholder="https://api.example.com/data"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.displayMode")}
        </label>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...config, displayMode: m.id })}
              className={`px-2 py-0.5 text-[10px] border transition-colors ${config.displayMode === m.id ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {config.displayMode === "value" && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t("homepage.displayField")}
            </label>
            <Input
              value={config.displayField ?? ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  displayField: e.target.value || undefined,
                })
              }
              placeholder="data.temperature"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("homepage.customApiLabel")}
              </label>
              <Input
                value={config.label ?? ""}
                onChange={(e) =>
                  onChange({ ...config, label: e.target.value || undefined })
                }
                placeholder={t("homepage.customApiLabelPlaceholder")}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-xs font-medium text-muted-foreground">
                {t("homepage.customApiUnit")}
              </label>
              <Input
                value={config.unit ?? ""}
                onChange={(e) =>
                  onChange({ ...config, unit: e.target.value || undefined })
                }
                placeholder="°C"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </>
      )}

      {config.displayMode === "table" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("homepage.jsonPath")}
          </label>
          <Input
            value={config.jsonPath ?? ""}
            onChange={(e) =>
              onChange({ ...config, jsonPath: e.target.value || undefined })
            }
            placeholder="data.items"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.refreshInterval")} ({t("homepage.seconds")})
        </label>
        <Input
          type="number"
          min={10}
          max={86400}
          value={config.refreshInterval}
          onChange={(e) =>
            onChange({
              ...config,
              refreshInterval: Math.max(10, Number(e.target.value)),
            })
          }
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
