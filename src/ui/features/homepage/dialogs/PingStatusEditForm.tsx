import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import type {
  PingStatusConfig,
  PingUrl,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function PingStatusEditForm({
  config,
  onChange,
}: WidgetEditFormProps<PingStatusConfig>) {
  const { t } = useTranslation();
  const { urls, refreshInterval, showLatency } = config;

  const updateUrl = (i: number, patch: Partial<PingUrl>) => {
    onChange({
      ...config,
      urls: urls.map((u, idx) => (idx === i ? { ...u, ...patch } : u)),
    });
  };
  const removeUrl = (i: number) =>
    onChange({ ...config, urls: urls.filter((_, idx) => idx !== i) });
  const addUrl = () =>
    onChange({ ...config, urls: [...urls, { label: "", url: "" }] });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
        {urls.map((u, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={u.label}
              onChange={(e) => updateUrl(i, { label: e.target.value })}
              placeholder={t("homepage.pingLabel")}
              className="h-7 text-xs flex-1"
            />
            <Input
              value={u.url}
              onChange={(e) => updateUrl(i, { url: e.target.value })}
              placeholder="https://..."
              className="h-7 text-xs flex-1"
            />
            <button
              onClick={() => removeUrl(i)}
              className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addUrl}
          className="mt-1 h-7 text-xs gap-1"
        >
          <Plus size={11} /> {t("homepage.addPingUrl")}
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.refreshInterval")} ({t("homepage.seconds")})
        </label>
        <Input
          type="number"
          min={10}
          max={3600}
          value={refreshInterval}
          onChange={(e) =>
            onChange({
              ...config,
              refreshInterval: Math.max(10, Number(e.target.value)),
            })
          }
          className="h-8 text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={showLatency}
          onChange={(e) =>
            onChange({ ...config, showLatency: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showLatency")}
      </label>
    </div>
  );
}
