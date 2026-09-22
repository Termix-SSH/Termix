/**
 * Host editor sections contributed by plugins.
 *
 * A plugin declares host-scope fields in its manifest and core draws them, so
 * a plugin cannot ship its own form styling and a section disappears when its
 * plugin does. The enable switch comes first and gates the rest, which is the
 * shape the hardcoded feature tabs already have.
 *
 * Nothing is rendered when no enabled plugin declares host settings, so the
 * group does not appear as an empty tab. Phase B fills it as each feature
 * moves its columns out of ssh_data.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/section-card";
import { PluginIcon } from "@/lib/plugin-icon";
import { getPlugins, type PluginSummary } from "@/api/plugins-api";
import { SettingsFieldRow } from "./SettingsFields";
import { isFieldActive } from "./settings-fields-util";

/** Values for every plugin on one host: { [pluginId]: { [key]: value } }. */
export type HostPluginSettings = Record<string, Record<string, unknown>>;

/** Enabled plugins declaring host-scope settings. */
export function usePluginHostSections(): PluginSummary[] {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {
        // Additive: the built-in host tabs do not depend on this.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () =>
      plugins.filter((plugin) => {
        if (!plugin.enabled) return false;
        const host = plugin.contributes?.settings?.host;
        return !!host && (host.fields.length > 0 || !!host.enableKey);
      }),
    [plugins],
  );
}

export interface HostPluginSectionsProps {
  plugins: PluginSummary[];
  values: HostPluginSettings;
  setValue: (pluginId: string, key: string, value: unknown) => void;
}

export function HostPluginSections({
  plugins,
  values,
  setValue,
}: HostPluginSectionsProps) {
  if (plugins.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {plugins.map((plugin) => (
        <HostPluginSection
          key={plugin.id}
          plugin={plugin}
          values={values[plugin.id] ?? {}}
          setValue={(key, value) => setValue(plugin.id, key, value)}
        />
      ))}
    </div>
  );
}

function HostPluginSection({
  plugin,
  values,
  setValue,
}: {
  plugin: PluginSummary;
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const host = plugin.contributes?.settings?.host;
  if (!host) return null;

  const running = plugin.enabled && plugin.state !== "failed";
  const enableKey = host.enableKey;
  // With no enable switch the section is always on, which is what a plugin
  // declaring only plain fields means.
  const enabled = enableKey ? values[enableKey] === true : true;

  return (
    <SectionCard
      title={plugin.name}
      icon={<PluginIcon name={plugin.icon} className="size-3.5" />}
    >
      {!running && (
        <div className="my-3 border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500">
          {t("settings.hostPluginNotRunning", { name: plugin.name })}
        </div>
      )}

      {enableKey && (
        <SettingsFieldRow
          pluginId={plugin.id}
          field={{
            key: enableKey,
            type: "boolean",
            labelKey: host.enableLabelKey,
          }}
          values={values}
          setValue={setValue}
          running={running}
        />
      )}

      {enabled &&
        host.fields
          .filter((field) => isFieldActive(field, values))
          .map((field) => (
            <SettingsFieldRow
              key={field.key}
              pluginId={plugin.id}
              field={field}
              values={values}
              setValue={setValue}
              running={running}
            />
          ))}
    </SectionCard>
  );
}
