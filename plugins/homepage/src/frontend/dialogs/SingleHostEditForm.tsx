import {
  useTranslation,
  useHosts,
  type PluginHostRecord,
} from "@termix/plugin-sdk/frontend";
import { Select2 } from "@termix/plugin-sdk/ui";

interface SingleHostEditFormProps {
  hostId: number;
  onChange: (hostId: number) => void;
  filter?: (host: PluginHostRecord) => boolean;
}

export function SingleHostEditForm({
  hostId,
  onChange,
  filter,
}: SingleHostEditFormProps) {
  const { t } = useTranslation();
  const { hosts: allHosts } = useHosts();
  const hosts = filter ? allHosts.filter(filter) : allHosts;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t("common.host")}
      </label>
      <Select2
        value={hostId || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs border border-border bg-background px-2"
      >
        <option value="">{t("common.selectHost")}</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name || h.ip}
          </option>
        ))}
      </Select2>
    </div>
  );
}
