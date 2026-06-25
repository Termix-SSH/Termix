import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  SshQuickConnectConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";

export function SshQuickConnectEditForm({
  config,
  onChange,
}: WidgetEditFormProps<SshQuickConnectConfig>) {
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
          {t("homepage.host")}
        </label>
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto border border-border/40 p-1">
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
          {t("homepage.connectionType")}
        </label>
        <div className="flex gap-1">
          {(["terminal", "files", "docker"] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => onChange({ ...config, connectionType: ct })}
              className={`px-2 py-0.5 text-[10px] border transition-colors capitalize ${config.connectionType === ct ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {ct}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.layout")}
        </label>
        <div className="flex gap-1">
          {(["list", "grid"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onChange({ ...config, layout: l })}
              className={`px-2 py-0.5 text-[10px] border transition-colors capitalize ${config.layout === l ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showStatus}
          onChange={(e) =>
            onChange({ ...config, showStatus: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showStatus")}
      </label>
    </div>
  );
}
