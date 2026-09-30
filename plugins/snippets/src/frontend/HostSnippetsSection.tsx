import { Plus, Play, Trash2, Zap } from "lucide-react";
import {
  useTranslation,
  type HostEditorSectionProps,
} from "@termix/plugin-sdk/frontend";
import {
  Button,
  HostDefaultBadge,
  HostDefaultField,
  Input,
  SectionCard,
  Select2,
} from "@termix/plugin-sdk/ui";
import { PLUGIN_ID, readStartupSnippetId } from "../shared/host-settings.js";
import { useSnippetOptions } from "./use-snippet-options";

type PluginSettingsBag = Record<string, Record<string, unknown>>;

/** A quick action row while it is being edited: the snippet may be unset. */
interface QuickActionRow {
  name: string;
  snippetId: number | null;
}

function readRows(value: unknown): QuickActionRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = (entry ?? {}) as { name?: unknown; snippetId?: unknown };
    const id = Number(row.snippetId);
    return {
      name: typeof row.name === "string" ? row.name : "",
      snippetId: Number.isInteger(id) && id > 0 ? id : null,
    };
  });
}

/**
 * The host editor's Snippets tab: the snippet a terminal runs when it
 * connects, and the quick action buttons Host Metrics shows for the host.
 * Both are this plugin's host settings, saved with the host.
 */
export function HostSnippetsSection({
  form,
  updateForm,
  adminTargetUserId,
}: HostEditorSectionProps) {
  const { t } = useTranslation();
  const { options } = useSnippetOptions(adminTargetUserId);
  const own =
    (form.pluginSettings as PluginSettingsBag | undefined)?.[PLUGIN_ID] ?? {};
  const startupSnippetId = readStartupSnippetId(own.startupSnippetId);
  const quickActions = readRows(own.quickActions);

  const write = (values: Record<string, unknown>) =>
    updateForm((current) => {
      const all =
        (current.pluginSettings as PluginSettingsBag | undefined) ?? {};
      return {
        ...current,
        pluginSettings: {
          ...all,
          [PLUGIN_ID]: { ...(all[PLUGIN_ID] ?? {}), ...values },
        },
      };
    });

  const setQuickActions = (rows: QuickActionRow[]) =>
    write({ quickActions: rows });

  return (
    <>
      <HostDefaultField settingKey="startupSnippetId">
        <SectionCard
          title={t("host.startupTitle")}
          icon={<Play className="size-3.5" />}
        >
          <div className="flex flex-col gap-1.5 py-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("host.startupDescription")}
              <HostDefaultBadge settingKey="startupSnippetId" />
            </p>
            <Select2
              aria-label={t("host.startupTitle")}
              value={startupSnippetId ?? ""}
              onChange={(e) =>
                write({
                  startupSnippetId: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("host.none")}</option>
              {options.map((snippet) => (
                <option key={snippet.id} value={snippet.id}>
                  {snippet.name}
                </option>
              ))}
            </Select2>
          </div>
        </SectionCard>
      </HostDefaultField>
      <HostDefaultField settingKey="quickActions">
        <SectionCard
          title={t("host.quickActionsTitle")}
          icon={<Zap className="size-3.5" />}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
              onClick={() =>
                setQuickActions([
                  ...quickActions,
                  { name: "", snippetId: null },
                ])
              }
            >
              <Plus className="size-3 mr-1" /> {t("host.addQuickAction")}
            </Button>
          }
        >
          <div className="flex flex-col gap-3 py-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("host.quickActionsDescription")}
              <HostDefaultBadge settingKey="quickActions" />
            </p>
            {quickActions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40 gap-1.5">
                <Zap className="size-6" />
                <span className="text-xs">{t("host.noQuickActions")}</span>
              </div>
            )}
            {quickActions.map((row, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 bg-muted/20 border border-border group"
              >
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder={t("host.buttonLabel")}
                  value={row.name}
                  onChange={(e) => {
                    const next = [...quickActions];
                    next[index] = { ...row, name: e.target.value };
                    setQuickActions(next);
                  }}
                />
                <Select2
                  aria-label={t("host.selectSnippet")}
                  className="h-7 text-xs flex-1 border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                  value={row.snippetId ?? ""}
                  onChange={(e) => {
                    const next = [...quickActions];
                    next[index] = {
                      ...row,
                      snippetId: e.target.value ? Number(e.target.value) : null,
                    };
                    setQuickActions(next);
                  }}
                >
                  <option value="">{t("host.selectSnippet")}</option>
                  {options.map((snippet) => (
                    <option key={snippet.id} value={snippet.id}>
                      {snippet.name}
                    </option>
                  ))}
                </Select2>
                <button
                  type="button"
                  aria-label={t("host.removeQuickAction")}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() =>
                    setQuickActions(quickActions.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      </HostDefaultField>
    </>
  );
}
