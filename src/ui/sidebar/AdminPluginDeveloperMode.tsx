import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingRow } from "@/components/section-card";
import { useConfirm } from "@/components/surface/surface-scope";
import { getDeveloperMode, setDeveloperMode } from "@/api/plugins-api";
import { AdminToggle } from "./AdminSettingsShared";

/** Lets admins install plugins from a file. Asks before turning it on. */
export function AdminPluginDeveloperMode() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(false);
  const [signedOnly, setSignedOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDeveloperMode()
      .then((state) => {
        if (cancelled) return;
        setEnabled(state.enabled);
        setSignedOnly(state.signedOnly);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    if (next) {
      const ok = await confirm({
        title: t("plugins.manager.developer.enableTitle"),
        description: t("plugins.manager.developer.enableBody"),
        confirmLabel: t("plugins.manager.developer.enable"),
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await setDeveloperMode(next);
      setEnabled(next);
    } catch (error) {
      toast.error(
        t("plugins.manager.errors.developerMode", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        label={t("plugins.manager.developer.title")}
        description={t("plugins.manager.developer.hint")}
      >
        <AdminToggle
          on={enabled}
          onToggle={() => void toggle()}
          disabled={!loaded || saving}
        />
      </SettingRow>
      {enabled && signedOnly && (
        <p className="text-[10px] text-destructive">
          {t("plugins.manager.developer.signedOnly")}
        </p>
      )}
    </>
  );
}
