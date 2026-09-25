/* eslint-disable react-refresh/only-export-components */
/**
 * Manifest-declared settings shown as ordinary sections in the profile and
 * admin panels, one per feature, named after it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { SectionCard } from "@/components/section-card";
import { AccordionSection } from "@/sidebar/AdminSettingsShared";
import { pluginKey } from "@/lib/plugin-i18n";
import { PluginIcon } from "@/lib/plugin-icon";
import {
  getPlugins,
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
import { hasVisibleFields, isFieldActive } from "./settings-fields-util";

export type FeatureSettingsScope = "admin" | "user";

export type FeatureSectionId = `feature:${string}`;

export function featureSectionId(pluginId: string): FeatureSectionId {
  return `feature:${pluginId}`;
}

/** Enabled features with fields in this scope, sorted by name. */
export function useFeatureSettings(
  scope: FeatureSettingsScope,
): PluginSummary[] {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () =>
      plugins
        .filter(
          (plugin) =>
            plugin.enabled &&
            hasVisibleFields(plugin.contributes?.settings?.[scope] ?? []),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [plugins, scope],
  );
}

export function FeatureSettingsSection({
  plugin,
  scope,
  open,
  onToggle,
}: {
  plugin: PluginSummary;
  scope: FeatureSettingsScope;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <AccordionSection
      label={plugin.name}
      icon={<PluginIcon name={plugin.icon} className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <FeatureSettingsForm
        plugin={plugin}
        scope={scope}
        fields={plugin.contributes?.settings?.[scope] ?? []}
      />
    </AccordionSection>
  );
}

function FeatureSettingsForm({
  plugin,
  scope,
  fields,
}: {
  plugin: PluginSummary;
  scope: FeatureSettingsScope;
  fields: PluginSettingsField[];
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<PluginSettingsErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const running = plugin.enabled && plugin.state !== "failed";

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

  // Groups appear in the order of their first field, so the manifest sets the layout.
  const groups = useMemo(() => {
    const ordered: { key?: string; fields: PluginSettingsField[] }[] = [];
    for (const field of fields) {
      const existing = ordered.find((group) => group.key === field.group);
      if (existing) existing.fields.push(field);
      else ordered.push({ key: field.group, fields: [field] });
    }
    return ordered;
  }, [fields]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  const rows = (group: PluginSettingsField[]) =>
    group
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
      ));

  const icon = <PluginIcon name={plugin.icon} className="size-3.5" />;

  return (
    <div className="flex flex-col gap-2 pt-2">
      {!running && (
        <div className="border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500">
          {t("settings.featureUnavailable", { name: plugin.name })}
        </div>
      )}

      {groups.map((group, index) =>
        group.key ? (
          <SectionCard
            key={group.key}
            title={t(pluginKey(plugin.id, group.key))}
            icon={icon}
          >
            {rows(group.fields)}
          </SectionCard>
        ) : (
          <div key={`group-${index}`}>{rows(group.fields)}</div>
        ),
      )}

      <div className="flex justify-end">
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
    </div>
  );
}
