/**
 * One plugin's settings page, drawn from its manifest.
 *
 * The plugin declares groups and fields; Termix renders them with the same
 * SectionCard and SettingRow everything else uses. A plugin cannot ship its
 * own form styling and drift from the rest of the app, and a page disappears
 * cleanly when the plugin is uninstalled.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { SectionCard } from "@/components/section-card";
import { pluginKey } from "@/lib/plugin-i18n";
import { PluginIcon } from "@/lib/plugin-icon";
import {
  getPluginAdminSettings,
  getPluginUserSettings,
  updatePluginAdminSettings,
  updatePluginUserSettings,
  PluginSettingsValidationError,
  type PluginSettingsErrors,
  type PluginSettingsField,
  type PluginSummary,
} from "@/api/plugins-api";
import { SettingsFieldRow } from "./SettingsFields";
import { isFieldActive } from "./settings-fields-util";

interface PluginSettingsPageProps {
  plugin: PluginSummary;
  isAdmin: boolean;
}

type Scope = "admin" | "user";

export function PluginSettingsPage({
  plugin,
  isAdmin,
}: PluginSettingsPageProps) {
  const { t } = useTranslation();
  const settings = plugin.contributes?.settings;
  const running = plugin.enabled && plugin.state !== "failed";

  // Admin fields are not merely disabled for a non-admin: the values behind
  // them are install-wide configuration they have no business reading.
  const scopes = useMemo(() => {
    const entries: { scope: Scope; fields: PluginSettingsField[] }[] = [];
    if (isAdmin && (settings?.admin?.length ?? 0) > 0) {
      entries.push({ scope: "admin", fields: settings!.admin! });
    }
    if ((settings?.user?.length ?? 0) > 0) {
      entries.push({ scope: "user", fields: settings!.user! });
    }
    return entries;
  }, [settings, isAdmin]);

  if (scopes.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2.5">
        <p className="text-xs text-muted-foreground px-1">
          {t("settings.pluginNoSettings", { name: plugin.name })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2.5">
      {!running && (
        <div className="border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500">
          {t("settings.pluginStoppedNotice", { name: plugin.name })}
        </div>
      )}

      {scopes.map(({ scope, fields }) => (
        <PluginScopeForm
          key={scope}
          plugin={plugin}
          scope={scope}
          fields={fields}
          running={running}
        />
      ))}
    </div>
  );
}

/**
 * One scope's form.
 *
 * Admin and user settings are separate requests with separate permissions, so
 * they save separately rather than sharing one dirty state.
 */
function PluginScopeForm({
  plugin,
  scope,
  fields,
  running,
}: {
  plugin: PluginSummary;
  scope: Scope;
  fields: PluginSettingsField[];
  running: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<PluginSettingsErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded =
        scope === "admin"
          ? await getPluginAdminSettings(plugin.id)
          : await getPluginUserSettings(plugin.id);
      setValues(loaded);
      setErrors({});
      setDirty(false);
    } catch {
      toast.error(t("settings.pluginSettingsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [plugin.id, scope, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setValue = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved =
        scope === "admin"
          ? await updatePluginAdminSettings(plugin.id, values)
          : await updatePluginUserSettings(plugin.id, values);
      setValues(saved);
      setErrors({});
      setDirty(false);
      toast.success(t("settings.pluginSettingsSaved"));
    } catch (error) {
      if (error instanceof PluginSettingsValidationError) {
        setErrors(error.errors);
        toast.error(t("settings.pluginSettingsInvalid"));
      } else {
        toast.error(t("settings.pluginSettingsSaveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  // Fields keep their declared order within a group, and groups appear in the
  // order their first field does, so a manifest controls the whole layout.
  const groups = useMemo(() => {
    const ordered: {
      key: string | undefined;
      fields: PluginSettingsField[];
    }[] = [];
    for (const field of fields) {
      const existing = ordered.find((group) => group.key === field.group);
      if (existing) existing.fields.push(field);
      else ordered.push({ key: field.group, fields: [field] });
    }
    return ordered;
  }, [fields]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  const icon = <PluginIcon name={plugin.icon} className="size-3.5" />;

  return (
    <>
      {groups.map((group, index) => (
        <SectionCard
          key={group.key ?? `group-${index}`}
          title={
            group.key
              ? t(pluginKey(plugin.id, group.key))
              : scope === "admin"
                ? t("settings.pluginGroupAdmin")
                : t("settings.pluginGroupUser")
          }
          icon={icon}
        >
          {group.fields
            .filter((field) => isFieldActive(field, values))
            .map((field) => (
              <SettingsFieldRow
                key={field.key}
                pluginId={plugin.id}
                field={field}
                values={values}
                setValue={setValue}
                running={running}
                error={errors[field.key]}
              />
            ))}
        </SectionCard>
      ))}

      <div className="flex justify-end px-1">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="size-3 animate-spin mr-1.5" />}
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}
