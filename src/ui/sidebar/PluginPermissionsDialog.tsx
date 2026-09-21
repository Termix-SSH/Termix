import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  grantPluginCapability,
  revokePluginCapability,
  type PluginSummary,
} from "@/api/plugins-api";
import { AdminToggle } from "./AdminSettingsShared";

/**
 * Every permission a plugin's manifest can declare, with the label and
 * one-line description shown here. process:transport-owner is left out on
 * purpose: it is reserved for first-party plugins and enforced by a hardcoded
 * allowlist, not something an admin grants, so showing a toggle for it would
 * be misleading. ui.* permissions describe what a plugin contributes to the
 * shell rather than a capability the broker gates, but they are still shown
 * here since the manifest can declare them and a plugin's grant list should
 * not silently hide part of what it asked for.
 */
const LABELED_PERMISSIONS: Array<{
  capability: string;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    capability: "hosts.read",
    labelKey: "admin.pluginPermissionHostsRead",
    descriptionKey: "admin.pluginPermissionHostsReadDesc",
  },
  {
    capability: "hosts.write",
    labelKey: "admin.pluginPermissionHostsWrite",
    descriptionKey: "admin.pluginPermissionHostsWriteDesc",
  },
  {
    capability: "credentials.use",
    labelKey: "admin.pluginPermissionCredentialsUse",
    descriptionKey: "admin.pluginPermissionCredentialsUseDesc",
  },
  {
    capability: "ssh.exec",
    labelKey: "admin.pluginPermissionSshExec",
    descriptionKey: "admin.pluginPermissionSshExecDesc",
  },
  {
    capability: "ssh.sftp",
    labelKey: "admin.pluginPermissionSshSftp",
    descriptionKey: "admin.pluginPermissionSshSftpDesc",
  },
  {
    capability: "storage.own",
    labelKey: "admin.pluginPermissionStorageOwn",
    descriptionKey: "admin.pluginPermissionStorageOwnDesc",
  },
  {
    capability: "storage.secrets",
    labelKey: "admin.pluginPermissionStorageSecrets",
    descriptionKey: "admin.pluginPermissionStorageSecretsDesc",
  },
  {
    capability: "network.outbound",
    labelKey: "admin.pluginPermissionNetworkOutbound",
    descriptionKey: "admin.pluginPermissionNetworkOutboundDesc",
  },
  {
    capability: "events.read",
    labelKey: "admin.pluginPermissionEventsRead",
    descriptionKey: "admin.pluginPermissionEventsReadDesc",
  },
  {
    capability: "notify.send",
    labelKey: "admin.pluginPermissionNotifySend",
    descriptionKey: "admin.pluginPermissionNotifySendDesc",
  },
  {
    capability: "users.read",
    labelKey: "admin.pluginPermissionUsersRead",
    descriptionKey: "admin.pluginPermissionUsersReadDesc",
  },
  {
    capability: "process.sidecar",
    labelKey: "admin.pluginPermissionProcessSidecar",
    descriptionKey: "admin.pluginPermissionProcessSidecarDesc",
  },
];

export function PluginPermissionsDialog({
  plugin,
  open,
  onOpenChange,
  onChanged,
}: {
  plugin: PluginSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);

  if (!plugin) return null;

  const rows = LABELED_PERMISSIONS.filter((row) =>
    plugin.permissions.includes(row.capability),
  );
  const granted = new Set(plugin.grantedCapabilities);

  const toggle = async (capability: string, isGranted: boolean) => {
    setBusy(capability);
    try {
      if (isGranted) {
        await revokePluginCapability(plugin.id, capability);
      } else {
        await grantPluginCapability(plugin.id, capability);
      }
      onChanged();
    } catch {
      toast.error(
        isGranted
          ? t("admin.pluginRevokeFailed")
          : t("admin.pluginGrantFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg rounded-none border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent-brand" />
            {t("admin.pluginPermissions")}
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold tracking-tight text-muted-foreground">
            {plugin.name}
          </DialogDescription>
        </DialogHeader>

        <div className="py-3">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">
              {t("admin.pluginPermissionsNone")}
            </p>
          ) : (
            <div className="border border-border overflow-hidden">
              {rows.map((row, i) => {
                const isGranted = granted.has(row.capability);
                return (
                  <div
                    key={row.capability}
                    className={`flex items-center justify-between gap-3 px-3 py-3 ${
                      i < rows.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-xs font-semibold">
                        {t(row.labelKey)}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {t(row.descriptionKey)}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                        {isGranted
                          ? t("admin.pluginPermissionGranted")
                          : t("admin.pluginPermissionNotGranted")}
                      </span>
                    </div>
                    <AdminToggle
                      on={isGranted}
                      onToggle={() => void toggle(row.capability, isGranted)}
                      disabled={busy === row.capability}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
