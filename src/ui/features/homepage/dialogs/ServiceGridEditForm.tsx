import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import type {
  ServiceGridConfig,
  ServiceGridItem,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function ServiceGridEditForm({
  config,
  onChange,
}: WidgetEditFormProps<ServiceGridConfig>) {
  const { t } = useTranslation();
  const { services, columns, showLabels, iconSize } = config;

  const updateItem = (i: number, patch: Partial<ServiceGridItem>) => {
    onChange({
      ...config,
      services: services.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    });
  };
  const removeItem = (i: number) =>
    onChange({ ...config, services: services.filter((_, idx) => idx !== i) });
  const addItem = () =>
    onChange({ ...config, services: [...services, { label: "", url: "" }] });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
        {services.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={s.label}
              onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder={t("homepage.linkLabel")}
              className="h-7 text-xs flex-1"
            />
            <Input
              value={s.url}
              onChange={(e) => updateItem(i, { url: e.target.value })}
              placeholder="https://..."
              className="h-7 text-xs flex-1"
            />
            <button
              onClick={() => removeItem(i)}
              className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addItem}
          className="mt-1 h-7 text-xs gap-1"
        >
          <Plus size={11} /> {t("homepage.addService")}
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("homepage.columns")}
          </label>
          <div className="flex gap-1">
            {([2, 3, 4] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...config, columns: c })}
                className={`px-3 py-0.5 text-[10px] border transition-colors ${columns === c ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("homepage.iconSize")}
          </label>
          <div className="flex gap-1">
            {(["sm", "md", "lg"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...config, iconSize: s })}
                className={`px-2 py-0.5 text-[10px] border transition-colors uppercase ${iconSize === s ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(e) =>
            onChange({ ...config, showLabels: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showLabels")}
      </label>
    </div>
  );
}
