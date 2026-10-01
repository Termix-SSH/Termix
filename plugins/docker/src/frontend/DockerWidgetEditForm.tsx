import { useHosts, useTranslation } from "@termix/plugin-sdk/frontend";
import { Select2 } from "@termix/plugin-sdk/ui";
import type { DockerWidgetConfig, WidgetEditFormProps } from "./homepage";
import { dockerEnabled } from "./types";

export function DockerWidgetEditForm({
  config,
  onChange,
}: WidgetEditFormProps<DockerWidgetConfig>) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const options = hosts.filter(
    (host) => host.enableSsh !== false && dockerEnabled(host),
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t("common.host")}
      </label>
      <Select2
        value={config.hostId || ""}
        onChange={(e) =>
          onChange({ ...config, hostId: Number(e.target.value) })
        }
        className="h-8 text-xs border border-border bg-background px-2"
      >
        <option value="">{t("common.selectHost")}</option>
        {options.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name || host.ip}
          </option>
        ))}
      </Select2>
    </div>
  );
}
