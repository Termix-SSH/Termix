/**
 * One control per declared settings field type.
 *
 * A plugin supplies data; core draws the form. That is what keeps every
 * plugin's settings page looking like the rest of the app, and what makes a
 * page disappear cleanly when its plugin does.
 */

import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import { Checkbox } from "@/components/checkbox";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/button";
import { FakeSwitch, SettingRow } from "@/components/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { pluginKey } from "@/lib/plugin-i18n";
import { isRedactedSecret, type PluginSettingsField } from "@/api/plugins-api";
import {
  getSettingsComponent,
  useSettingsComponents,
} from "./settings-components";

export interface SettingsFieldProps {
  pluginId: string;
  field: PluginSettingsField;
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  /** Whether the owning plugin is running. */
  running: boolean;
  /** Message from a rejected save, shown under the control. */
  error?: string;
  disabled?: boolean;
}

export function SettingsFieldRow({
  pluginId,
  field,
  values,
  setValue,
  running,
  error,
  disabled = false,
}: SettingsFieldProps) {
  const { t } = useTranslation();
  // A custom component appears once its plugin's frontend has registered it.
  useSettingsComponents();
  const label = (key?: string) => (key ? t(pluginKey(pluginId, key)) : "");

  // A custom field draws its own row: it has no single control to put in the
  // right-hand slot, and often no label of its own either.
  if (field.type === "custom") {
    const Component = getSettingsComponent(pluginId, field.component);
    if (!Component) return null;
    return (
      <Component
        pluginId={pluginId}
        values={values}
        setValue={setValue}
        running={running}
      />
    );
  }

  const value = values[field.key];
  const readOnly = disabled || !running;

  const description = field.descriptionKey ? (
    <>
      {label(field.descriptionKey)}
      {error && <span className="block text-destructive mt-0.5">{error}</span>}
    </>
  ) : error ? (
    <span className="text-destructive">{error}</span>
  ) : undefined;

  return (
    <SettingRow
      label={label(field.labelKey)}
      description={description}
      badge={error ? t("common.error") : undefined}
    >
      <FieldControl
        pluginId={pluginId}
        field={field}
        value={value}
        setValue={setValue}
        readOnly={readOnly}
      />
    </SettingRow>
  );
}

function FieldControl({
  pluginId,
  field,
  value,
  setValue,
  readOnly,
}: {
  pluginId: string;
  field: PluginSettingsField;
  value: unknown;
  setValue: (key: string, value: unknown) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const label = (key?: string) => (key ? t(pluginKey(pluginId, key)) : "");
  const placeholder = field.placeholderKey
    ? label(field.placeholderKey)
    : undefined;

  switch (field.type) {
    case "boolean":
      return (
        <FakeSwitch
          checked={value === true}
          disabled={readOnly}
          onChange={(next) => setValue(field.key, next)}
        />
      );

    case "number":
      return (
        <Input
          type="number"
          className="h-7 w-40 text-sm"
          disabled={readOnly}
          min={field.min}
          max={field.max}
          placeholder={placeholder}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) =>
            setValue(
              field.key,
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        />
      );

    case "select":
      return (
        <Select
          disabled={readOnly}
          value={typeof value === "string" ? value : ""}
          onValueChange={(next) => setValue(field.key, next)}
        >
          <SelectTrigger className="h-7 w-52 text-sm">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {label(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5 items-end">
          {(field.options ?? []).map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span>{label(option.labelKey)}</span>
              <Checkbox
                disabled={readOnly}
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  setValue(
                    field.key,
                    checked
                      ? [...selected, option.value]
                      : selected.filter((entry) => entry !== option.value),
                  )
                }
              />
            </label>
          ))}
        </div>
      );
    }

    case "secret":
      return (
        <SecretControl
          field={field}
          value={value}
          setValue={setValue}
          readOnly={readOnly}
          placeholder={placeholder}
        />
      );

    case "textarea":
    case "json":
      return (
        <Textarea
          className="w-64 text-sm font-mono min-h-16"
          disabled={readOnly}
          placeholder={placeholder}
          value={
            typeof value === "string"
              ? value
              : value === undefined || value === null
                ? ""
                : JSON.stringify(value, null, 2)
          }
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      );

    default:
      return (
        <Input
          className="h-7 w-52 text-sm"
          disabled={readOnly}
          placeholder={placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      );
  }
}

/**
 * A secret is never sent to the browser, so the control shows whether one is
 * stored and offers to replace or clear it. Leaving it untouched sends the
 * redacted marker straight back, which the server reads as "no change".
 */
function SecretControl({
  field,
  value,
  setValue,
  readOnly,
  placeholder,
}: {
  field: PluginSettingsField;
  value: unknown;
  setValue: (key: string, value: unknown) => void;
  readOnly: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const redacted = isRedactedSecret(value);
  const stored = redacted && value.set;

  if (redacted) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {stored ? t("settings.secretSet") : t("settings.secretNotSet")}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={readOnly}
          onClick={() => setValue(field.key, "")}
        >
          {stored ? t("settings.secretReplace") : t("common.edit")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <PasswordInput
        className="h-7 w-52 text-sm"
        disabled={readOnly}
        placeholder={placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => setValue(field.key, event.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        disabled={readOnly}
        onClick={() => setValue(field.key, { set: stored })}
      >
        {t("common.cancel")}
      </Button>
    </div>
  );
}
