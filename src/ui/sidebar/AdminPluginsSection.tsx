import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SettingRow } from "@/components/section-card";
import { Button } from "@/components/button";
import {
  getPlugins,
  setPluginEnabled,
  type PluginSummary,
} from "@/api/plugins-api";
import { syncPlugins } from "@/plugin-host/loader";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";
import { PluginPermissionsDialog } from "./PluginPermissionsDialog";

export function AdminPluginsSection({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [permissionsTargetId, setPermissionsTargetId] = useState<string | null>(
    null,
  );
  const permissionsTarget =
    plugins.find((plugin) => plugin.id === permissionsTargetId) ?? null;

  const load = useCallback(async () => {
    try {
      setPlugins(await getPlugins());
    } catch {
      toast.error(t("admin.pluginsLoadFailed"));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  const toggle = async (plugin: PluginSummary) => {
    setBusy(plugin.id);
    try {
      await setPluginEnabled(plugin.id, !plugin.enabled);
      await load();
      // Re-read state so the shell picks the change up without a reload.
      await syncPlugins();
      toast.success(
        plugin.enabled
          ? t("admin.pluginDisabled", { name: plugin.name })
          : t("admin.pluginEnabled", { name: plugin.name }),
      );
    } catch {
      toast.error(t("admin.pluginToggleFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AccordionSection
        label={t("admin.plugins")}
        icon={<Puzzle className="size-3.5" />}
        open={open}
        onToggle={onToggle}
      >
        {plugins.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            {loaded ? t("admin.pluginsNone") : t("common.loading")}
          </p>
        ) : (
          plugins.map((plugin) => (
            <SettingRow
              key={plugin.id}
              label={plugin.name}
              badge={
                plugin.tier === "bundled" ? t("admin.pluginBuiltIn") : undefined
              }
              description={
                plugin.lastError
                  ? plugin.lastError
                  : `v${plugin.version} · ${plugin.state}`
              }
            >
              <div className="flex items-center gap-2">
                {(plugin.capabilities?.length ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none h-7 px-2 text-[10px] font-bold uppercase tracking-widest"
                    onClick={() => setPermissionsTargetId(plugin.id)}
                  >
                    <ShieldCheck className="size-3" />
                    {t("admin.pluginPermissions")}
                  </Button>
                )}
                <AdminToggle
                  on={plugin.enabled}
                  onToggle={() => void toggle(plugin)}
                  disabled={busy === plugin.id}
                />
              </div>
            </SettingRow>
          ))
        )}
      </AccordionSection>

      <PluginPermissionsDialog
        plugin={permissionsTarget}
        open={permissionsTargetId !== null}
        onOpenChange={(next) => {
          if (!next) setPermissionsTargetId(null);
        }}
        onChanged={() => void load()}
      />
    </>
  );
}
