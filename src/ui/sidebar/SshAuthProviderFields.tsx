import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginSettingsField } from "@termix/plugin-sdk/manifest";
import { SettingsFieldRow } from "@/settings/SettingsFields";
import {
  getPluginHostSettings,
  updatePluginHostSettings,
  PluginSettingsValidationError,
} from "@/api/plugins-api";

/**
 * Fields an SSH auth type declares, for a plugin that did not register its
 * own editor. They are the plugin's host settings (so the plugin reads them
 * with ctx.settings.getHost), which means a host must be saved first.
 */
export function SshAuthProviderFields({
  pluginId,
  hostId,
  fields,
}: {
  pluginId: string;
  hostId: number | null | undefined;
  fields: PluginSettingsField[];
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hostId) return;
    let cancelled = false;
    getPluginHostSettings(pluginId, hostId)
      .then((loaded) => {
        if (!cancelled) setValues(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [pluginId, hostId]);

  if (!hostId) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {t("hosts.authFieldsAfterSave")}
      </p>
    );
  }

  const setValue = (key: string, value: unknown) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updatePluginHostSettings(pluginId, hostId, { [key]: value })
        .then(() => setErrors((prev) => ({ ...prev, [key]: "" })))
        .catch((error) => {
          if (error instanceof PluginSettingsValidationError) {
            setErrors((prev) => ({ ...prev, ...error.errors }));
          }
        });
    }, 400);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {fields.map((field) => (
        <SettingsFieldRow
          key={field.key}
          pluginId={pluginId}
          field={field}
          values={values}
          setValue={setValue}
          running
          error={errors[field.key] || undefined}
        />
      ))}
    </div>
  );
}
