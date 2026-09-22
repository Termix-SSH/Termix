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
import { CAPABILITY_CATALOG } from "@termix/plugin-sdk/capabilities";

/**
 * The catalog is the list. It is ordered worst first, so the riskiest thing a
 * plugin asked for is the first row an admin reads rather than something they
 * have to scroll for.
 */
const LABELED_PERMISSIONS = CAPABILITY_CATALOG.map((capability) => ({
  capability: capability.id,
  labelKey: capability.titleKey,
  descriptionKey: capability.consequenceKey,
}));

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

  const declared = plugin.capabilities ?? [];
  const rows = LABELED_PERMISSIONS.filter((row) =>
    declared.includes(row.capability),
  );
  const granted = new Set(plugin.grantedCapabilities ?? []);

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
