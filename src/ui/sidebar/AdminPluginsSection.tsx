import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react";
import { toast } from "sonner";
import { SettingRow } from "@/components/section-card";
import {
  getPlugins,
  setPluginEnabled,
  type PluginSummary,
} from "@/api/plugins-api";
import { refreshPluginState } from "@/shell/pluginLoader";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";

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
      await refreshPluginState();
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
              plugin.tier === "first-party"
                ? t("admin.pluginBuiltIn")
                : undefined
            }
            description={
              plugin.lastError
                ? plugin.lastError
                : `v${plugin.version} · ${plugin.runtimeState}`
            }
          >
            <AdminToggle
              on={plugin.enabled}
              onToggle={() => void toggle(plugin)}
              disabled={busy === plugin.id}
            />
          </SettingRow>
        ))
      )}
    </AccordionSection>
  );
}
