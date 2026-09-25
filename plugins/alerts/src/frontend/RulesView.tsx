import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useConfirmation,
} from "@termix/plugin-sdk/ui";
import {
  SEVERITIES,
  type AlertRule,
  type ChannelSummary,
  type Severity,
} from "../types";
import type { AlertsApi, RuleInput } from "./api";

const EMPTY: RuleInput = {
  name: "",
  match: "*",
  minSeverity: "warning",
  channelIds: [],
  enabled: true,
};

export function RulesView({ api }: { api: AlertsApi }) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [draft, setDraft] = useState<RuleInput>(EMPTY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ruleList, channelList, categoryList] = await Promise.all([
        api.rules(),
        api.channels(),
        api.categories(),
      ]);
      setRules(ruleList);
      setChannels(channelList);
      setCategories([...new Set(categoryList.map((entry) => entry.category))]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const channelName = (id: number) =>
    channels.find((channel) => channel.id === id)?.name ?? `#${id}`;

  const openEditor = (rule: AlertRule | null) => {
    setEditing(rule);
    setDraft(
      rule
        ? {
            name: rule.name,
            match: rule.match,
            minSeverity: rule.minSeverity,
            channelIds: rule.channelIds,
            enabled: rule.enabled,
          }
        : EMPTY,
    );
    setDialogOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error(t("rules.nameRequired"));
      return;
    }
    if (draft.channelIds.length === 0) {
      toast.error(t("rules.channelRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateRule(editing.id, draft);
      else await api.createRule(draft);
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule: AlertRule, enabled: boolean) => {
    try {
      await api.updateRule(rule.id, {
        name: rule.name,
        match: rule.match,
        minSeverity: rule.minSeverity,
        channelIds: rule.channelIds,
        enabled,
      });
      setRules((current) =>
        current.map((entry) =>
          entry.id === rule.id ? { ...entry, enabled } : entry,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = (rule: AlertRule) => {
    void confirmWithToast(
      t("rules.deleteConfirm", { name: rule.name }),
      async () => {
        try {
          await api.deleteRule(rule.id);
          await load();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      },
      t("actions.delete"),
      t("actions.cancel"),
    );
  };

  const toggleChannel = (id: number, checked: boolean) =>
    setDraft((current) => ({
      ...current,
      channelIds: checked
        ? [...new Set([...current.channelIds, id])]
        : current.channelIds.filter((entry) => entry !== id),
    }));

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted-foreground">{t("rules.intro")}</p>
      <Button
        size="sm"
        variant="outline"
        className="rounded-none self-start border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
        disabled={channels.length === 0}
        title={channels.length === 0 ? t("rules.needChannel") : undefined}
        onClick={() => openEditor(null)}
      >
        <Plus className="size-3.5 mr-1" />
        {t("rules.add")}
      </Button>

      {loading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground m-4" />
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          {channels.length === 0 ? t("rules.needChannel") : t("rules.empty")}
        </p>
      ) : (
        <div className="flex flex-col border border-border">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0"
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => void toggle(rule, checked)}
                aria-label={t("rules.enabled")}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{rule.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {t("rules.summary", {
                    match:
                      rule.match === "*" ? t("rules.everything") : rule.match,
                    severity: t(`severity.${rule.minSeverity}`),
                    channels: rule.channelIds.map(channelName).join(", "),
                  })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-none"
                title={t("rules.edit")}
                aria-label={t("rules.edit")}
                onClick={() => openEditor(rule)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-none"
                title={t("actions.delete")}
                aria-label={t("actions.delete")}
                onClick={() => remove(rule)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("rules.edit") : t("rules.add")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("rules.name")}
              </label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                className="text-sm rounded-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("rules.match")}
              </label>
              <Input
                value={draft.match}
                list="alerts-rule-categories"
                onChange={(event) =>
                  setDraft({ ...draft, match: event.target.value })
                }
                placeholder="*"
                className="text-sm font-mono rounded-none"
              />
              <datalist id="alerts-rule-categories">
                <option value="*" />
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <span className="text-[10px] text-muted-foreground">
                {t("rules.matchHint")}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("rules.minSeverity")}
              </label>
              <Select
                value={draft.minSeverity}
                onValueChange={(value) =>
                  setDraft({ ...draft, minSeverity: value as Severity })
                }
              >
                <SelectTrigger className="h-8 rounded-none text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.filter((value) => value !== "success").map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`severity.${value}`)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("rules.channels")}
              </label>
              <div className="flex flex-col gap-1.5 border border-border p-2 max-h-40 overflow-y-auto">
                {channels.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={draft.channelIds.includes(channel.id)}
                      onCheckedChange={(checked) =>
                        toggleChannel(channel.id, checked === true)
                      }
                    />
                    <span className="truncate">{channel.name}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {t(`channels.types.${channel.type}`)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-none"
              onClick={() => setDialogOpen(false)}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-none border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            >
              {saving ? t("actions.saving") : t("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
