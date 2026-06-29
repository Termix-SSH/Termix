import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";

interface SingleHostEditFormProps {
  hostId: number;
  onChange: (hostId: number) => void;
  filter?: (host: SSHHostWithStatus) => boolean;
}

export function SingleHostEditForm({
  hostId,
  onChange,
  filter,
}: SingleHostEditFormProps) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);

  useEffect(() => {
    getSSHHosts()
      .then((all) => setHosts(filter ? all.filter(filter) : all))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t("homepage.host")}
      </label>
      <select
        value={hostId || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs border border-border bg-background px-2"
      >
        <option value="">{t("homepage.selectHost")}</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name || h.ip}
          </option>
        ))}
      </select>
    </div>
  );
}
