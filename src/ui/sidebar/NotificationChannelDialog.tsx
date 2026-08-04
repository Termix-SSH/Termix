import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { toast } from "sonner";
import {
  createNotificationChannel,
  updateNotificationChannel,
  type NotificationChannel,
} from "@/api/alerts-api";

interface NotificationChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: NotificationChannel | null;
  onSaved: () => void;
}

type ChannelType = "webhook" | "ntfy" | "discord";

interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
}

interface DiscordConfig {
  url: string;
  username?: string;
  avatar_url?: string;
}

export function NotificationChannelDialog({
  open,
  onOpenChange,
  channel,
  onSaved,
}: NotificationChannelDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("webhook");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [ntfyUrl, setNtfyUrl] = useState("https://ntfy.sh");
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [ntfyToken, setNtfyToken] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [discordAvatarUrl, setDiscordAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (channel) {
      setName(channel.name);
      setType(channel.type);
      try {
        const cfg = JSON.parse(channel.config);
        if (channel.type === "webhook") {
          setWebhookUrl((cfg as WebhookConfig).url ?? "");
        } else if (channel.type === "discord") {
          const dc = cfg as DiscordConfig;
          setWebhookUrl(dc.url ?? "");
          setDiscordUsername(dc.username ?? "");
          setDiscordAvatarUrl(dc.avatar_url ?? "");
        } else {
          const nc = cfg as NtfyConfig;
          setNtfyUrl(nc.url ?? "https://ntfy.sh");
          setNtfyTopic(nc.topic ?? "");
          setNtfyToken(nc.token ?? "");
        }
      } catch {
        // ignore malformed config
      }
    } else {
      setName("");
      setType("webhook");
      setWebhookUrl("");
      setNtfyUrl("https://ntfy.sh");
      setNtfyTopic("");
      setNtfyToken("");
    }
  }, [open, channel]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("alerts.channelNameRequired", "Name is required"));
      return;
    }
    let config: WebhookConfig | NtfyConfig | DiscordConfig;
    if (type === "webhook") {
      if (!webhookUrl.trim()) {
        toast.error(t("alerts.webhookUrlRequired", "Webhook URL is required"));
        return;
      }
      config = {
        url: webhookUrl.trim(),
      } satisfies WebhookConfig;
    } else if (type === "discord") {
      const trimmedUrl = webhookUrl.trim();
      if (!trimmedUrl) {
        toast.error(t("alerts.webhookUrlRequired", "Webhook URL is required"));
        return;
      }
      if (
        !/^https:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/.+/i.test(
          trimmedUrl,
        )
      ) {
        toast.error(
          t(
            "alerts.discordUrlInvalid",
            "Discord URL must be a valid Discord webhook URL",
          ),
        );
        return;
      }
      const dc: DiscordConfig = { url: trimmedUrl };
      if (discordUsername.trim()) dc.username = discordUsername.trim();
      if (discordAvatarUrl.trim()) dc.avatar_url = discordAvatarUrl.trim();
      config = dc;
    } else {
      if (!ntfyTopic.trim()) {
        toast.error(t("alerts.ntfyTopicRequired", "Topic is required"));
        return;
      }
      const cfg: NtfyConfig = { url: ntfyUrl.trim(), topic: ntfyTopic.trim() };
      if (ntfyToken.trim()) cfg.token = ntfyToken.trim();
      config = cfg;
    }

    setSaving(true);
    try {
      if (channel) {
        await updateNotificationChannel(channel.id, {
          name: name.trim(),
          type,
          config,
        });
      } else {
        await createNotificationChannel({ name: name.trim(), type, config });
      }
      onSaved();
    } catch {
      toast.error(t("alerts.channelSaveFailed", "Failed to save channel"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {channel
              ? t("alerts.editChannel", "Edit Channel")
              : t("alerts.addChannel", "Add Channel")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.channelName", "Name")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.channelType", "Type")}
            </label>
            <div className="flex gap-2">
              {(["webhook", "ntfy", "discord"] as ChannelType[]).map((ct) => (
                <button
                  key={ct}
                  onClick={() => setType(ct)}
                  className={`px-3 py-1 text-xs font-semibold border transition-colors ${type === ct ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:border-accent-brand/30"}`}
                >
                  {ct === "webhook" ? "Webhook" : ct === "ntfy" ? "ntfy" : "Discord"}
                </button>
              ))}
            </div>
          </div>

          {type === "webhook" && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("alerts.webhookUrl", "URL")}
              </label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="text-sm font-mono"
              />
              <span className="text-[10px] text-muted-foreground">
                {t(
                  "alerts.webhookDesc",
                  "POST JSON payload to this URL on each alert firing",
                )}
              </span>
            </div>
          )}

          {type === "discord" && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("alerts.webhookUrl", "Discord webhook URL")}
              </label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="text-sm font-mono"
              />
              <span className="text-[10px] text-muted-foreground">
                {t(
                  "alerts.discordWebhookDesc",
                  "POST a Discord embed to this webhook URL on each alert firing",
                )}
              </span>

              <div className="flex flex-col gap-1 pt-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.discordUsername", "Display name (optional)")}
                </label>
                <Input
                  value={discordUsername}
                  onChange={(e) => setDiscordUsername(e.target.value)}
                  placeholder="Termix"
                  className="text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.discordAvatar", "Avatar URL (optional)")}
                </label>
                <Input
                  value={discordAvatarUrl}
                  onChange={(e) => setDiscordAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                  className="text-sm font-mono"
                />
              </div>
            </div>
          )}

          {type === "ntfy" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.ntfyServer", "Server URL")}
                </label>
                <Input
                  value={ntfyUrl}
                  onChange={(e) => setNtfyUrl(e.target.value)}
                  placeholder="https://ntfy.sh"
                  className="text-sm font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.ntfyTopic", "Topic")}
                </label>
                <Input
                  value={ntfyTopic}
                  onChange={(e) => setNtfyTopic(e.target.value)}
                  placeholder="my-alerts"
                  className="text-sm font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.ntfyToken", "Access Token (optional)")}
                </label>
                <Input
                  type="password"
                  value={ntfyToken}
                  onChange={(e) => setNtfyToken(e.target.value)}
                  placeholder="tk_..."
                  className="text-sm font-mono"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={saving}
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          >
            {saving
              ? t("common.saving", "Saving...")
              : t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
