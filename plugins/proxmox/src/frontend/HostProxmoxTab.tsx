import { useEffect, useState } from "react";
import { useSshAuthTypes, useTranslation } from "@termix/plugin-sdk/frontend";
import { Server } from "lucide-react";
import { Input } from "@/components/input";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { getCredentials } from "@/main-axios";
import type { HostEditorForm } from "@/sidebar/HostEditorData";
import { Select2 } from "@/components/select2";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostProxmoxTab({
  form,
  setField,
}: {
  form: HostEditorForm;
  setField: SetHostField;
}) {
  const { t } = useTranslation();
  const sshAuthTypes = useSshAuthTypes();
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
    defaultAuthType: "password",
    windowsPatterns: "win, windows",
    dockerPatterns: "docker",
    preferredPrefixes: "10., 192.168.",
    autoSyncEnabled: false,
    syncIntervalMinutes: 15,
    markMissingGuests: true,
  };
  const lastSyncResult = cfg.lastSyncResult;
  const lastSyncSummary = lastSyncResult
    ? t("hosts.proxmoxLastSyncSummary", {
        created: lastSyncResult.created,
        updated: lastSyncResult.updated,
        markedMissing: lastSyncResult.markedMissing,
        skipped: lastSyncResult.skipped,
      })
    : t("hosts.proxmoxLastSyncNoResult");
  const lastSyncDescription = cfg.lastSyncAt
    ? `${new Date(cfg.lastSyncAt).toLocaleString()} · ${lastSyncSummary}`
    : t("hosts.proxmoxLastSyncNever");

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
              label={t("hosts.proxmoxDefaultAuthType")}
              description={t("hosts.proxmoxDefaultAuthTypeDesc")}
            >
              <Select2
                value={cfg.defaultAuthType ?? "password"}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    defaultAuthType: e.target.value,
                  })
                }
                className="h-7 w-44 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
              >
                {sshAuthTypes.types.map((option) => (
                  <option key={option.type} value={option.type}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select2>
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxDefaultCredential")}
              description={t("hosts.proxmoxDefaultCredentialDesc")}
            >
              <Select2
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
              </Select2>
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
            <SettingRow
              label={t("hosts.proxmoxAutoSync")}
              description={t("hosts.proxmoxAutoSyncDesc")}
            >
              <FakeSwitch
                checked={cfg.autoSyncEnabled === true}
                onChange={(v) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    autoSyncEnabled: v,
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxSyncInterval")}
              description={t("hosts.proxmoxSyncIntervalDesc")}
            >
              <Input
                className="w-24 h-7 text-xs"
                type="number"
                min={5}
                value={cfg.syncIntervalMinutes ?? 15}
                onChange={(e) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    syncIntervalMinutes: Math.max(
                      5,
                      Number.parseInt(e.target.value || "15", 10),
                    ),
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxMarkMissing")}
              description={t("hosts.proxmoxMarkMissingDesc")}
            >
              <FakeSwitch
                checked={cfg.markMissingGuests !== false}
                onChange={(v) =>
                  setField("proxmoxConfig", {
                    ...cfg,
                    markMissingGuests: v,
                  })
                }
              />
            </SettingRow>
            <SettingRow
              label={t("hosts.proxmoxLastSync")}
              description={lastSyncDescription}
            >
              <span
                className={`text-xs ${
                  cfg.lastSyncStatus === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                title={cfg.lastSyncError ?? undefined}
              >
                {cfg.lastSyncStatus
                  ? t(`hosts.proxmoxLastSyncStatus.${cfg.lastSyncStatus}`)
                  : t("hosts.proxmoxLastSyncStatus.pending")}
              </span>
            </SettingRow>
          </>
        )}
      </div>
    </SectionCard>
  );
}
