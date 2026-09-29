import { useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { ArrowLeft, FileText } from "lucide-react";
import { Button, Input, SectionCard, Select2 } from "@termix/plugin-sdk/ui";
import type { Snippet, SnippetFolder } from "./types";

export interface SnippetFormValues {
  name: string;
  content: string;
  description: string;
  folder: string;
  isNote: boolean;
}

const labelClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

export function SnippetEditor({
  snippet,
  defaultFolder,
  folders,
  onBack,
  onSave,
}: {
  /** The snippet being edited, or null to create one. */
  snippet: Snippet | null;
  defaultFolder?: string;
  folders: SnippetFolder[];
  onBack: () => void;
  onSave: (values: SnippetFormValues) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<SnippetFormValues>(() => ({
    name: snippet?.name ?? "",
    content: snippet?.content ?? "",
    description: snippet?.description ?? "",
    folder: snippet?.folder ?? defaultFolder ?? "",
    isNote: snippet?.isNote ?? false,
  }));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof SnippetFormValues>(
    key: K,
    value: SnippetFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const canSave = !!values.name.trim() && !!values.content.trim() && !saving;
  // A snippet can point at a folder that has no metadata row yet.
  const folderNames = Array.from(
    new Set([
      ...folders.map((f) => f.name),
      ...(values.folder ? [values.folder] : []),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-2 shrink-0 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        <span>{t("backToSnippets")}</span>
        {snippet && (
          <span
            className="ml-auto font-semibold text-foreground truncate max-w-[200px]"
            title={snippet.name}
          >
            {snippet.name}
          </span>
        )}
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <SectionCard
          title={t(snippet ? "editSnippetTitle" : "createSnippetTitle")}
          icon={<FileText className="size-3.5" />}
        >
          <div className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>
                {t("nameLabel")} <span className="text-accent-brand">*</span>
              </label>
              <Input
                autoFocus
                value={values.name}
                placeholder={t("namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>{t("descriptionLabel")}</label>
              <Input
                value={values.description}
                placeholder={t("descriptionPlaceholder")}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>{t("folderLabel")}</label>
              <Select2
                value={values.folder}
                onChange={(e) => set("folder", e.target.value)}
              >
                <option value="">{t("noFolder")}</option>
                {folderNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select2>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>{t("typeLabel")}</label>
              <div className="flex items-stretch border border-border">
                {[false, true].map((isNote) => (
                  <button
                    key={String(isNote)}
                    type="button"
                    onClick={() => set("isNote", isNote)}
                    className={`flex-1 h-8 text-xs transition-colors ${isNote ? "border-l border-border" : ""} ${
                      values.isNote === isNote
                        ? "bg-accent-brand/10 text-accent-brand"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {t(isNote ? "typeNote" : "typeCommand")}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {t(values.isNote ? "typeNoteHint" : "typeCommandHint")}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>
                {t(values.isNote ? "noteLabel" : "commandLabel")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <textarea
                value={values.content}
                placeholder={t(
                  values.isNote ? "notePlaceholder" : "commandPlaceholder",
                )}
                onChange={(e) => set("content", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                className="w-full min-h-36 px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-y outline-none focus:ring-1 focus:ring-ring font-mono"
              />
              <span className="text-[10px] text-muted-foreground/70 font-mono">
                {t("variablesHint")}
              </span>
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onBack} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-6"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {t(snippet ? "saveSnippetButton" : "createSnippetButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}
