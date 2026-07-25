import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getUserPreferences,
  parseCustomKeybindings,
} from "@/api/open-tabs-api";
import { saveUserPreferences, getSnippets } from "@/main-axios";
import { BUILT_IN_DEFAULTS } from "@/lib/default-keybindings";
import type {
  CustomKeybinding,
  KeyCombo,
  KeybindingActionType,
} from "@/types/keybindings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";

interface SnippetOption {
  id: number;
  name: string;
}

function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Cmd");
  parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  return parts.join(" + ");
}

const ACTION_LABEL_KEYS: Record<KeybindingActionType, string> = {
  copy: "newUi.sidebar.keybindings.actionCopy",
  paste: "newUi.sidebar.keybindings.actionPaste",
  sendControlCode: "newUi.sidebar.keybindings.actionSendControlCode",
  sendText: "newUi.sidebar.keybindings.actionSendText",
  runSnippet: "newUi.sidebar.keybindings.actionRunSnippet",
};

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `kb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function KeybindingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<CustomKeybinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [snippets, setSnippets] = useState<SnippetOption[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [overridesDefaultId, setOverridesDefaultId] = useState<
    string | undefined
  >(undefined);

  const [recordedCombo, setRecordedCombo] = useState<KeyCombo | null>(null);
  const [recording, setRecording] = useState(false);
  const [actionType, setActionType] =
    useState<KeybindingActionType>("sendText");
  const [text, setText] = useState("");
  const [appendEnter, setAppendEnter] = useState(false);
  const [controlCode, setControlCode] = useState("");
  const [snippetId, setSnippetId] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      getUserPreferences().catch(() => null),
      getSnippets().catch(() => []),
    ])
      .then(([prefs, snippetList]) => {
        setBindings(
          prefs ? parseCustomKeybindings(prefs.customKeybindings) : [],
        );
        const list = Array.isArray(snippetList) ? snippetList : [];
        setSnippets(
          list.map((s: { id: number; name: string }) => ({
            id: s.id,
            name: s.name,
          })),
        );
      })
      .finally(() => setLoading(false));
  }, [open]);

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

  function resetForm() {
    setEditingId(null);
    setOverridesDefaultId(undefined);
    setRecordedCombo(null);
    setRecording(false);
    setActionType("sendText");
    setText("");
    setAppendEnter(false);
    setControlCode("");
    setSnippetId("");
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
    setActionType(kb.action.type);
    setText(kb.action.text ?? "");
    setAppendEnter(kb.action.appendEnter ?? false);
    setControlCode(kb.action.controlCode ?? "");
    setSnippetId(kb.action.snippetId ?? "");
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

  function handleDelete(id: string) {
    persist(bindings.filter((kb) => kb.id !== id));
  }

  function handleResetAll() {
    persist([]);
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
    if (actionType === "sendText" && !text.trim()) {
      toast.error(t("newUi.sidebar.keybindings.textRequiredError"));
      return;
    }
    if (actionType === "sendControlCode" && !/^[a-zA-Z]$/.test(controlCode)) {
      toast.error(t("newUi.sidebar.keybindings.controlCodeRequiredError"));
      return;
    }
    if (actionType === "runSnippet" && !snippetId) {
      toast.error(t("newUi.sidebar.keybindings.snippetRequiredError"));
      return;
    }

    const now = new Date().toISOString();
    const existing = editingId
      ? bindings.find((kb) => kb.id === editingId)
      : undefined;

    const newBinding: CustomKeybinding = {
      id: editingId ?? generateId(),
      combo: recordedCombo,
      action: {
        type: actionType,
        text: actionType === "sendText" ? text : undefined,
        controlCode:
          actionType === "sendControlCode"
            ? controlCode.toLowerCase()
            : undefined,
        snippetId: actionType === "runSnippet" ? snippetId : undefined,
        appendEnter:
          actionType === "runSnippet"
            ? true
            : actionType === "sendText"
              ? appendEnter
              : undefined,
      },
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("newUi.sidebar.keybindings.title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("newUi.sidebar.keybindings.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-1 max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("newUi.sidebar.keybindings.defaultsHeading")}
              </span>
              {BUILT_IN_DEFAULTS.map((def) => {
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
                        {def.description}
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
                            onClick={() => handleDelete(override.id)}
                            title={t(
                              "newUi.sidebar.keybindings.resetToDefault",
                            )}
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("newUi.sidebar.keybindings.customHeading")}
                </span>
                <Button variant="outline" size="sm" onClick={openAddForm}>
                  <Plus className="size-3.5 mr-1" />
                  {t("newUi.sidebar.keybindings.addBinding")}
                </Button>
              </div>
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
                  const orphaned =
                    kb.action.type === "runSnippet" &&
                    !snippets.some((s) => String(s.id) === kb.action.snippetId);
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
                          {t(ACTION_LABEL_KEYS[kb.action.type])}
                          {orphaned && (
                            <span className="text-destructive">
                              {" "}
                              (
                              {t(
                                "newUi.sidebar.keybindings.orphanedSnippetWarning",
                              )}
                              )
                            </span>
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
                          onClick={() => handleDelete(kb.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 mt-2">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={handleResetAll}
              disabled={bindings.length === 0}
            >
              {t("newUi.sidebar.keybindings.resetAllToDefaults")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("newUi.sidebar.keybindings.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {editingId || overridesDefaultId
                ? t("newUi.sidebar.keybindings.editBindingTitle")
                : t("newUi.sidebar.keybindings.addBindingTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">
                {t("newUi.sidebar.keybindings.pressKeysToRecord")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <Input
                readOnly
                value={
                  recording
                    ? t("newUi.sidebar.keybindings.recording")
                    : recordedCombo
                      ? formatCombo(recordedCombo)
                      : ""
                }
                placeholder={t(
                  "newUi.sidebar.keybindings.pressKeysPlaceholder",
                )}
                onFocus={(e) => startRecording(e.currentTarget)}
                className="font-mono cursor-pointer"
              />
              {conflictWarning && (
                <span className="text-xs text-yellow-500">
                  {conflictWarning}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">
                {t("newUi.sidebar.keybindings.actionLabel")}
              </label>
              <select
                value={actionType}
                onChange={(e) =>
                  setActionType(e.target.value as KeybindingActionType)
                }
                className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="copy">
                  {t("newUi.sidebar.keybindings.actionCopy")}
                </option>
                <option value="paste">
                  {t("newUi.sidebar.keybindings.actionPaste")}
                </option>
                <option value="sendControlCode">
                  {t("newUi.sidebar.keybindings.actionSendControlCode")}
                </option>
                <option value="sendText">
                  {t("newUi.sidebar.keybindings.actionSendText")}
                </option>
                <option value="runSnippet">
                  {t("newUi.sidebar.keybindings.actionRunSnippet")}
                </option>
              </select>
              {actionType === "paste" && (
                <span className="text-xs text-muted-foreground">
                  {t("newUi.sidebar.keybindings.clipboardPermissionNote")}
                </span>
              )}
            </div>

            {actionType === "sendControlCode" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold">
                  {t("newUi.sidebar.keybindings.controlCodeLabel")}
                </label>
                <Input
                  value={controlCode}
                  maxLength={1}
                  onChange={(e) => setControlCode(e.target.value)}
                  placeholder="w"
                  className="w-16 font-mono"
                />
              </div>
            )}

            {actionType === "sendText" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold">
                  {t("newUi.sidebar.keybindings.textLabel")}
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full h-24 px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={appendEnter}
                    onChange={(e) => setAppendEnter(e.target.checked)}
                  />
                  {t("newUi.sidebar.keybindings.appendEnterLabel")}
                </label>
              </div>
            )}

            {actionType === "runSnippet" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold">
                  {t("newUi.sidebar.keybindings.snippetLabel")}
                </label>
                <select
                  value={snippetId}
                  onChange={(e) => setSnippetId(e.target.value)}
                  className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">
                    {t("newUi.sidebar.keybindings.selectSnippetPlaceholder")}
                  </option>
                  {snippets.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              {t("newUi.sidebar.keybindings.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleSave}
            >
              {t("newUi.sidebar.keybindings.saveBinding")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
