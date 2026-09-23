import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Box } from "lucide-react";
import { Select2 } from "@/components/select2";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type { HostEditorForm } from "@/sidebar/HostEditorData";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostDockerTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();
  const dockerConfig = form.dockerConfig ?? { runtime: "docker" as const };
  const runtime =
    dockerConfig.runtime === "podman"
      ? ("podman" as const)
      : ("docker" as const);

  return (
    <SectionCard
      title={t("hosts.dockerIntegration")}
      icon={<Box className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-3">
        <SettingRow
          label={t("hosts.enableDockerMonitor")}
          description={t("hosts.enableDockerMonitorDesc")}
        >
          <FakeSwitch
            checked={form.enableDocker}
            onChange={(v) => setField("enableDocker", v)}
          />
        </SettingRow>
        {form.enableDocker && (
          <SettingRow
            label={t("hosts.containerRuntime")}
            description={t("hosts.containerRuntimeDesc")}
          >
            <Select2
              value={runtime}
              onChange={(e) =>
                setField("dockerConfig", {
                  ...dockerConfig,
                  runtime: e.target.value as "docker" | "podman",
                })
              }
              className="h-7 w-44 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="docker">
                {t("hosts.containerRuntimeDocker")}
              </option>
              <option value="podman">
                {t("hosts.containerRuntimePodman")}
              </option>
            </Select2>
          </SettingRow>
        )}
      </div>
    </SectionCard>
  );
}
