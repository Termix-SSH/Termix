import { Select2 } from "@/components/select2";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getUserPreferences,
  parseCustomKeybindings,
} from "@/api/open-tabs-api";
import { saveUserPreferences } from "@/main-axios";
import {
  useKeybindingActions,
  useKeybindingDefaults,
  type KeybindingActionDef,
} from "@/shell/keybinding-registry";
import type {
  CustomKeybinding,
  KeybindingAction,
  KeyCombo,
} from "@/types/keybindings";
import { InlineView, useConfirm } from "@/components/surface/surface-scope";
import { GroupHeading } from "@/components/panel-layout";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Keyboard, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { FixedShortcutsList } from "@/sidebar/FixedShortcutsList";

function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Cmd");
  parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  return parts.join(" + ");
}

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `kb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** An action without the keys an editor cleared, so it saves clean. */
function withoutEmpty(action: KeybindingAction): KeybindingAction {
  const out: KeybindingAction = { type: action.type };
  for (const [key, value] of Object.entries(action)) {
    if (key !== "type" && value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Settings > Keybindings. The actions come from the keybinding registry:
 * the shell's own and whatever the running plugins register, each with its
 * own parameter editor. A saved binding whose plugin is off stays in the
 * list and keeps working once the plugin is back.
 */
export function KeybindingsSettings() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const actions = useKeybindingActions();
  const defaults = useKeybindingDefaults();
  const [bindings, setBindings] = useState<CustomKeybinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overridesDefaultId, setOverridesDefaultId] = useState<
    string | undefined
  >(undefined);

  const [recordedCombo, setRecordedCombo] = useState<KeyCombo | null>(null);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<KeybindingAction>({ type: "" });

  const actionById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions],
  );
  const draftDef: KeybindingActionDef | undefined = actionById.get(draft.type);

  useEffect(() => {
    setLoading(true);
    getUserPreferences()
      .then((prefs) =>
        setBindings(parseCustomKeybindings(prefs.customKeybindings)),
      )
      .catch(() => setBindings([]))
      .finally(() => setLoading(false));
  }, []);

  const conflictWarning = useMemo(() => {
    if (!recordedCombo) return null;
    const conflict = bindings.find(
      (kb) =>
        kb.id !== editingId &&
        kb.enabled &&
        kb.combo.ctrl === recordedCombo.ctrl &&
        kb.combo.alt === recordedCombo.alt &&
        kb.combo.shift === recordedCombo.shift &&
        kb.combo.meta === recordedCombo.meta &&
        kb.combo.key === recordedCombo.key,
    );
    if (conflict) {
      return t("newUi.sidebar.keybindings.conflictWarning", {
        combo: formatCombo(conflict.combo),
      });
    }
    return null;
  }, [recordedCombo, bindings, editingId, t]);

  function actionLabel(type: string): string {
    const def = actionById.get(type);
    return def
      ? t(def.labelKey)
      : t("newUi.sidebar.keybindings.unavailableAction", { type });
  }

  function resetForm() {
    setEditingId(null);
    setOverridesDefaultId(undefined);
    setRecordedCombo(null);
    setRecording(false);
    setDraft({ type: actions[0]?.id ?? "" });
  }

  function openAddForm() {
    resetForm();
    setFormOpen(true);
  }

  function openEditForm(kb: CustomKeybinding) {
    setEditingId(kb.id);
    setOverridesDefaultId(kb.overridesDefaultId);
    setRecordedCombo(kb.combo);
    setRecording(false);
    setDraft({ ...kb.action });
    setFormOpen(true);
  }

  function openOverrideDefaultForm(defaultId: string, combo: KeyCombo) {
    resetForm();
    setOverridesDefaultId(defaultId);
    setRecordedCombo(combo);
    setFormOpen(true);
  }

  async function persist(updated: CustomKeybinding[]) {
    try {
      await saveUserPreferences({
        customKeybindings: JSON.stringify(updated),
      });
      setBindings(updated);
      window.dispatchEvent(new Event("customKeybindingsChanged"));
    } catch {
      toast.error(t("newUi.sidebar.keybindings.saveError"));
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t("newUi.sidebar.keybindings.deleteConfirm"),
    });
    if (ok) persist(bindings.filter((kb) => kb.id !== id));
  }

  async function handleResetAll() {
    const ok = await confirm({
      title: t("newUi.sidebar.keybindings.resetAllConfirm"),
      confirmLabel: t("newUi.sidebar.keybindings.resetAllToDefaults"),
    });
    if (ok) persist([]);
  }

  function startRecording(inputEl: HTMLInputElement) {
    setRecording(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        return;
      }
      const isAlnum = /^[a-zA-Z0-9]$/.test(e.key);
      const combo: KeyCombo = {
        key: isAlnum ? e.key.toLowerCase() : e.code,
        isCode: !isAlnum,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      };
      setRecordedCombo(combo);
      setRecording(false);
      inputEl.removeEventListener("keydown", handler, true);
      inputEl.blur();
    };
    inputEl.addEventListener("keydown", handler, true);
  }

  function handleSave() {
    if (!recordedCombo) {
      toast.error(t("newUi.sidebar.keybindings.comboRequiredError"));
      return;
    }
    if (!draftDef) {
      toast.error(t("newUi.sidebar.keybindings.actionRequiredError"));
      return;
    }
    const action = withoutEmpty(draft);
    const problem = draftDef.validate?.(action);
    if (problem) {
      toast.error(t(problem));
      return;
    }

    const now = new Date().toISOString();
    const existing = editingId
      ? bindings.find((kb) => kb.id === editingId)
      : undefined;

    const newBinding: CustomKeybinding = {
      id: editingId ?? generateId(),
      combo: recordedCombo,
      action,
      enabled: true,
      overridesDefaultId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const updated = editingId
      ? bindings.map((kb) => (kb.id === editingId ? newBinding : kb))
      : [...bindings, newBinding];

    persist(updated);
    setFormOpen(false);
    resetForm();
  }

  const customOnlyBindings = bindings.filter((kb) => !kb.overridesDefaultId);
  const Editor = draftDef?.editor;

  return (
    <>
      <div className="flex flex-col gap-4 border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">
          {t("newUi.sidebar.keybindings.description")}
        </p>
        {defaults.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <GroupHeading
              title={t("newUi.sidebar.keybindings.defaultsHeading")}
            />
            {defaults.map((def) => {
              const override = bindings.find(
                (kb) => kb.overridesDefaultId === def.id,
              );
              return (
                <div
                  key={def.id}
                  className="flex items-center justify-between gap-2 border border-border bg-background px-2.5 py-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-mono">
                      {override
                        ? formatCombo(override.combo)
                        : formatCombo(def.combo)}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {t(def.descriptionKey)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {override ? (
                      <>
                        <span className="text-[10px] font-bold text-accent-brand border border-accent-brand/40 px-1">
                          {t("newUi.sidebar.keybindings.customizedBadge")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => openEditForm(override)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => void handleDelete(override.id)}
                          title={t("newUi.sidebar.keybindings.resetToDefault")}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] text-muted-foreground border border-border px-1">
                          {t("newUi.sidebar.keybindings.defaultBadge")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() =>
                            openOverrideDefaultForm(def.id, def.combo)
                          }
                          title={t("newUi.sidebar.keybindings.customize")}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <GroupHeading
            title={t("newUi.sidebar.keybindings.customHeading")}
            action={
              <Button variant="outline" size="sm" onClick={openAddForm}>
                <Plus className="size-3.5 mr-1" />
                {t("newUi.sidebar.keybindings.addBinding")}
              </Button>
            }
          />
          {loading ? (
            <span className="text-xs text-muted-foreground">
              {t("newUi.sidebar.keybindings.loading")}
            </span>
          ) : customOnlyBindings.length === 0 ? (
            <span className="text-xs text-muted-foreground/60">
              {t("newUi.sidebar.keybindings.noCustomBindings")}
            </span>
          ) : (
            customOnlyBindings.map((kb) => {
              const Summary = actionById.get(kb.action.type)?.summary;
              return (
                <div
                  key={kb.id}
                  className="flex items-center justify-between gap-2 border border-border bg-background px-2.5 py-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-mono">
                      {formatCombo(kb.combo)}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {actionLabel(kb.action.type)}
                      {Summary && (
                        <>
                          {" "}
                          <Summary action={kb.action} onChange={() => {}} />
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => openEditForm(kb)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(kb.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <FixedShortcutsList />
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => void handleResetAll()}
          disabled={bindings.length === 0}
        >
          <RotateCcw className="size-3.5 mr-1" />
          {t("newUi.sidebar.keybindings.resetAllToDefaults")}
        </Button>
      </div>

      <InlineView
        open={formOpen}
        onOpenChange={setFormOpen}
        icon={<Keyboard className="size-4" />}
        title={
          editingId || overridesDefaultId
            ? t("newUi.sidebar.keybindings.editBindingTitle")
            : t("newUi.sidebar.keybindings.addBindingTitle")
        }
        footer={
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFormOpen(false)}
            >
              {t("newUi.sidebar.keybindings.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleSave}
            >
              {t("newUi.sidebar.keybindings.saveBinding")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.keybindings.pressKeysToRecord")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              data-keybinding-recorder
              readOnly
              value={
                recording
                  ? t("newUi.sidebar.keybindings.recording")
                  : recordedCombo
                    ? formatCombo(recordedCombo)
                    : ""
              }
              placeholder={t("newUi.sidebar.keybindings.pressKeysPlaceholder")}
              onFocus={(e) => startRecording(e.currentTarget)}
              className="font-mono cursor-pointer"
            />
            {conflictWarning && (
              <span className="text-xs text-warning">{conflictWarning}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.keybindings.actionLabel")}
            </label>
            <Select2
              value={draft.type}
              onChange={(e) => setDraft({ type: e.target.value })}
              className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              {!draftDef && draft.type && (
                <option value={draft.type}>{actionLabel(draft.type)}</option>
              )}
              {actions.map((action) => (
                <option key={action.id} value={action.id}>
                  {t(action.labelKey)}
                </option>
              ))}
            </Select2>
          </div>

          {Editor && <Editor action={draft} onChange={setDraft} />}
        </div>
      </InlineView>
    </>
  );
}
