import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  QuickConnectConfig,
  QuickConnectType,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";

const ALL_TYPES: QuickConnectType[] = [
  "terminal",
  "files",
  "docker",
  "tunnel",
  "host-metrics",
  "rdp",
  "vnc",
  "telnet",
];

export function QuickConnectEditForm({
  config,
  onChange,
}: WidgetEditFormProps<QuickConnectConfig>) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);

  useEffect(() => {
    getSSHHosts()
      .then(setHosts)
      .catch(() => {});
  }, []);

  const toggleHost = (id: number) => {
    const current = config.hostIds;
    const ids = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    onChange({ ...config, hostIds: ids });
  };

  const toggleType = (type: QuickConnectType) => {
    const types = config.connectionTypes.includes(type)
      ? config.connectionTypes.filter((x) => x !== type)
      : [...config.connectionTypes, type];
    onChange({ ...config, connectionTypes: types });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.selectHosts")}
        </label>
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto border border-border/30 p-2">
          {hosts.length === 0 && (
            <span className="text-xs text-muted-foreground/60">
              {t("homepage.noHosts")}
            </span>
          )}
          {hosts.map((h) => (
            <label
              key={h.id}
              className="flex items-center gap-2 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={config.hostIds.includes(h.id)}
                onChange={() => toggleHost(h.id)}
                className="accent-accent-brand"
              />
              <span className="truncate">{h.name || h.ip}</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          {t("homepage.hostGridAllHint")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.connectionTypes")}
        </label>
        <div className="grid grid-cols-2 gap-1">
          {ALL_TYPES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={config.connectionTypes.includes(type)}
                onChange={() => toggleType(type)}
                className="accent-accent-brand"
              />
              {t(`homepage.connType_${type}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.layout")}
        </label>
        <div className="flex gap-3">
          {(["list", "grid"] as const).map((l) => (
            <label
              key={l}
              className="flex items-center gap-1.5 text-xs cursor-pointer"
            >
              <input
                type="radio"
                name="layout"
                value={l}
                checked={config.layout === l}
                onChange={() => onChange({ ...config, layout: l })}
                className="accent-accent-brand"
              />
              {l === "list"
                ? t("homepage.listLayout")
                : t("homepage.gridLayout")}
            </label>
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
