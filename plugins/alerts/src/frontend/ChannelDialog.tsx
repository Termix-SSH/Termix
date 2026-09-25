import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PasswordInput,
  Switch,
  Textarea,
  cn,
} from "@termix/plugin-sdk/ui";
import { CHANNEL_TYPES, type ChannelType } from "../types";
import { EMPTY, configFrom, draftFrom, type Draft } from "./channel-config";
import type { AlertsApi } from "./api";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

export function ChannelDialog({
  api,
  open,
  channelId,
  emailAvailable,
  onOpenChange,
  onSaved,
}: {
  api: AlertsApi;
  open: boolean;
  /** Null to create a new channel. */
  channelId: number | null;
  emailAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (channelId === null) {
      setDraft(EMPTY);
      return;
    }
    api
      .channel(channelId)
      .then((channel) => setDraft(draftFrom(channel)))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
  }, [api, channelId, open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const pickType = (type: ChannelType) =>
    setDraft((current) => ({
      ...current,
      type,
      url:
        type === "ntfy" && !current.url
          ? "https://ntfy.sh"
          : type !== "ntfy" && current.url === "https://ntfy.sh"
            ? ""
            : current.url,
    }));

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error(t("channels.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: draft.name.trim(),
        type: draft.type,
        config: configFrom(draft),
      };
      if (channelId === null) await api.createChannel(input);
      else await api.updateChannel(channelId, input);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const canReachPrivate = draft.type === "webhook" || draft.type === "ntfy";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader>
          <DialogTitle>
            {channelId === null ? t("channels.add") : t("channels.edit")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <Field label={t("channels.name")}>
            <Input
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              className="text-sm rounded-none"
            />
          </Field>

          <Field label={t("channels.type")}>
            <div className="flex flex-wrap gap-2">
              {CHANNEL_TYPES.map((type) => {
                const disabled = type === "email" && !emailAvailable;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={disabled}
                    title={
                      disabled ? t("channels.emailUnavailable") : undefined
                    }
                    onClick={() => pickType(type)}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                      draft.type === type
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:border-accent-brand/30",
                    )}
                  >
                    {t(`channels.types.${type}`)}
                  </button>
                );
              })}
            </div>
            {draft.type === "email" && !emailAvailable && (
              <span className="text-[10px] text-destructive">
                {t("channels.emailUnavailable")}
              </span>
            )}
          </Field>

          {draft.type === "webhook" && (
            <>
              <Field
                label={t("channels.webhookUrl")}
                hint={t("channels.webhookHint")}
              >
                <Input
                  value={draft.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://example.com/webhook"
                  className="text-sm font-mono rounded-none"
                />
              </Field>
              <Field label={t("channels.method")}>
                <div className="flex gap-2">
                  {(["POST", "PUT"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => set("method", method)}
                      className={cn(
                        "px-3 py-1 text-xs font-mono border transition-colors",
                        draft.method === method
                          ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </Field>
              <Field
                label={t("channels.headers")}
                hint={t("channels.headersHint")}
              >
                <Textarea
                  value={draft.headers}
                  onChange={(event) => set("headers", event.target.value)}
                  placeholder="Authorization: Bearer ..."
                  rows={3}
                  className="text-xs font-mono rounded-none"
                />
              </Field>
            </>
          )}

          {draft.type === "ntfy" && (
            <>
              <Field label={t("channels.ntfyServer")}>
                <Input
                  value={draft.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://ntfy.sh"
                  className="text-sm font-mono rounded-none"
                />
              </Field>
              <Field label={t("channels.ntfyTopic")}>
                <Input
                  value={draft.topic}
                  onChange={(event) => set("topic", event.target.value)}
                  placeholder="my-alerts"
                  className="text-sm font-mono rounded-none"
                />
              </Field>
              <Field label={t("channels.ntfyToken")}>
                <PasswordInput
                  value={draft.token}
                  onChange={(event) => set("token", event.target.value)}
                  placeholder="tk_..."
                  className="text-sm font-mono rounded-none"
                />
              </Field>
            </>
          )}

          {draft.type === "discord" && (
            <>
              <Field
                label={t("channels.discordUrl")}
                hint={t("channels.discordHint")}
              >
                <Input
                  value={draft.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="text-sm font-mono rounded-none"
                />
              </Field>
              <Field label={t("channels.discordUsername")}>
                <Input
                  value={draft.username}
                  onChange={(event) => set("username", event.target.value)}
                  placeholder="Termix"
                  className="text-sm rounded-none"
                />
              </Field>
              <Field label={t("channels.discordAvatar")}>
                <Input
                  value={draft.avatarUrl}
                  onChange={(event) => set("avatarUrl", event.target.value)}
                  placeholder="https://example.com/avatar.png"
                  className="text-sm font-mono rounded-none"
                />
              </Field>
            </>
          )}

          {draft.type === "email" && (
            <Field label={t("channels.emailTo")} hint={t("channels.emailHint")}>
              <Input
                value={draft.to}
                onChange={(event) => set("to", event.target.value)}
                placeholder="ops@example.com"
                className="text-sm rounded-none"
              />
            </Field>
          )}

          {canReachPrivate && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium">
                  {t("channels.privateNetwork")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("channels.privateNetworkHint")}
                </span>
              </div>
              <Switch
                checked={draft.allowPrivateNetwork}
                onCheckedChange={(checked) =>
                  set("allowPrivateNetwork", checked)
                }
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-none"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-none border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          >
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
