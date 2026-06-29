import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  HostGridConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";

export function HostGridEditForm({
  config,
  onChange,
}: WidgetEditFormProps<HostGridConfig>) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    getSSHHosts()
      .then((h) => setHosts(h.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, []);

  const toggleHost = (id: number) => {
    const next = config.hostIds.includes(id)
      ? config.hostIds.filter((x) => x !== id)
      : [...config.hostIds, id];
    onChange({ ...config, hostIds: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.hostGridHosts")}
        </label>
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto border border-border/40 p-1">
          {hosts.length === 0 && (
            <span className="text-[10px] text-muted-foreground p-1">
              {t("homepage.noHosts")}
            </span>
          )}
          {hosts.map((h) => (
            <label
              key={h.id}
              className="flex items-center gap-2 text-[10px] cursor-pointer px-1 py-0.5 hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={config.hostIds.includes(h.id)}
                onChange={() => toggleHost(h.id)}
                className="accent-accent-brand"
              />
              {h.name}
            </label>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground">
          {t("homepage.hostGridAllHint")}
        </span>
      </div>

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
              className={`px-3 py-0.5 text-[10px] font-medium border transition-colors ${config.columns === c ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showIp}
          onChange={(e) => onChange({ ...config, showIp: e.target.checked })}
          className="accent-accent-brand"
        />
        {t("homepage.showIp")}
      </label>
    </div>
  );
}
