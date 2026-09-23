import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Server } from "lucide-react";
import { Input } from "@/components/input";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type { HostEditorForm } from "@/sidebar/HostEditorData";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostProxmoxStatsTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("hosts.enableProxmoxStats")}
      icon={<Server className="size-3.5" />}
    >
      <div className="flex flex-col gap-0 py-1">
        <SettingRow
          label={t("hosts.enableProxmoxStats")}
          description={t("hosts.enableProxmoxStatsDesc")}
        >
          <FakeSwitch
            checked={form.enableProxmoxStats}
            onChange={(v) => setField("enableProxmoxStats", v)}
          />
        </SettingRow>
        {form.enableProxmoxStats && (
          <>
            <SettingRow
              label={t("hosts.proxmoxStatsPollInterval")}
              description={t("hosts.proxmoxStatsPollIntervalDesc")}
            >
              <Input
                className="w-24 h-7 text-xs"
                type="number"
                min={15}
                value={form.proxmoxStatsConfig?.pollInterval ?? 60}
                onChange={(e) =>
                  setField("proxmoxStatsConfig", {
                    ...form.proxmoxStatsConfig,
                    pollInterval: Math.max(
                      15,
                      Number.parseInt(e.target.value || "60", 10),
                    ),
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxStatsNodeOverride")}
              description={t("hosts.proxmoxStatsNodeOverrideDesc")}
            >
              <Input
                className="w-44 h-7 text-xs"
                value={form.proxmoxStatsConfig?.nodeName ?? ""}
                placeholder={t("hosts.proxmoxStatsNodeOverridePlaceholder")}
                onChange={(e) =>
                  setField("proxmoxStatsConfig", {
                    ...form.proxmoxStatsConfig,
                    nodeName: e.target.value || null,
                  })
                }
              />
            </SettingRow>
          </>
        )}
      </div>
    </SectionCard>
  );
}
