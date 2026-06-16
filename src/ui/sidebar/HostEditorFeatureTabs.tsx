import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, FolderSearch, Server } from "lucide-react";

import { Input } from "@/components/input";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { getCredentials } from "@/main-axios";
import type { HostEditorForm } from "./HostEditorData";

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
      </div>
    </SectionCard>
  );
}

export function HostProxmoxTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<
    { id: number; name: string; username: string | null }[]
  >([]);

  useEffect(() => {
    getCredentials()
      .then((res: unknown) => {
        const raw =
          (res as { credentials?: unknown })?.credentials ?? res ?? [];
        const list = (Array.isArray(raw) ? raw : []).map(
          (c: Record<string, unknown>) => ({
            id: c.id as number,
            name: c.name as string,
            username: (c.username as string | null) ?? null,
          }),
        );
        setCredentials(list);
      })
      .catch(() => {});
  }, []);

  const cfg = form.proxmoxConfig ?? {
    defaultCredentialId: null,
    windowsPatterns: "win, windows",
    dockerPatterns: "docker",
    preferredPrefixes: "10., 192.168.",
  };

  return (
    <SectionCard
      title={t("hosts.proxmoxIntegration")}
      icon={<Server className="size-3.5" />}
    >
      <div className="flex flex-col gap-0 py-1">
        <SettingRow
          label={t("hosts.enableProxmox")}
          description={
            <>
              {t("hosts.enableProxmoxDesc")}{" "}
              <a
                href="https://docs.termix.site/features/files-and-hosts/proxmox-import"
                target="_blank"
                rel="noreferrer"
                className="text-accent-brand hover:underline"
              >
                {t("hosts.docsLink")}
              </a>
            </>
          }
        >
          <FakeSwitch
            checked={form.enableProxmox}
            onChange={(v) => setField("enableProxmox", v)}
          />
        </SettingRow>
        {form.enableProxmox && (
          <>
            <SettingRow
              label={t("hosts.proxmoxDefaultCredential")}
              description={t("hosts.proxmoxDefaultCredentialDesc")}
            >
              <select
                value={cfg.defaultCredentialId ?? ""}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    defaultCredentialId: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                className="h-7 w-44 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("hosts.none")}</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.username ? `${c.name} (${c.username})` : c.name}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxWindowsDetection")}
              description={t("hosts.proxmoxWindowsDetectionDesc")}
            >
              <Input
                className="w-44 h-7 text-xs"
                value={cfg.windowsPatterns}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    windowsPatterns: e.target.value,
                  })
                }
                placeholder="win, windows"
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxDockerDetection")}
              description={t("hosts.proxmoxDockerDetectionDesc")}
            >
              <Input
                className="w-44 h-7 text-xs"
                value={cfg.dockerPatterns}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    dockerPatterns: e.target.value,
                  })
                }
                placeholder="docker"
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxPreferredRanges")}
              description={t("hosts.proxmoxPreferredRangesDesc")}
            >
              <Input
                className="w-44 h-7 text-xs"
                value={cfg.preferredPrefixes}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    preferredPrefixes: e.target.value,
                  })
                }
                placeholder="10., 192.168."
              />
            </SettingRow>
          </>
        )}
      </div>
    </SectionCard>
  );
}

export function HostFilesTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("hosts.fileManager")}
      icon={<FolderSearch className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-3">
        <SettingRow
          label={t("hosts.enableFileManagerMonitor")}
          description={t("hosts.enableFileManagerMonitorDesc")}
        >
          <FakeSwitch
            checked={form.enableFileManager}
            onChange={(v) => setField("enableFileManager", v)}
          />
        </SettingRow>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("hosts.defaultPathLabel")}
          </label>
          <Input
            placeholder="/"
            value={form.defaultPath}
            onChange={(e) => setField("defaultPath", e.target.value)}
          />
          <span className="text-[10px] text-muted-foreground">
            {t("hosts.fileManagerPathHint")}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
