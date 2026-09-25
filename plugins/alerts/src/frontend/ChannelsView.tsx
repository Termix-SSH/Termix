import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Badge, Button, Switch, useConfirmation } from "@termix/plugin-sdk/ui";
import type { ChannelSummary } from "../types";
import type { AlertsApi } from "./api";
import { ChannelDialog } from "./ChannelDialog";

export function ChannelsView({
  api,
  onChanged,
}: {
  api: AlertsApi;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, meta] = await Promise.all([api.channels(), api.meta()]);
      setChannels(list);
      setEmailAvailable(meta.emailAvailable);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const test = async (channel: ChannelSummary) => {
    setTesting(channel.id);
    try {
      await api.testChannel(channel.id);
      toast.success(t("channels.testSent"));
    } catch (error) {
      toast.error(
        t("channels.testFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setTesting(null);
    }
  };

  const toggle = async (channel: ChannelSummary, enabled: boolean) => {
    try {
      await api.updateChannel(channel.id, { enabled });
      setChannels((current) =>
        current.map((entry) =>
          entry.id === channel.id ? { ...entry, enabled } : entry,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = (channel: ChannelSummary) => {
    void confirmWithToast(
      t("channels.deleteConfirm", { name: channel.name }),
      async () => {
        try {
          await api.deleteChannel(channel.id);
          toast.success(t("channels.deleted"));
          await load();
          onChanged?.();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      },
      t("actions.delete"),
      t("actions.cancel"),
    );
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted-foreground">{t("channels.intro")}</p>
      <Button
        size="sm"
        variant="outline"
        className="rounded-none self-start border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
        onClick={() => {
          setEditingId(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="size-3.5 mr-1" />
        {t("channels.add")}
      </Button>

      {loading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground m-4" />
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          {t("channels.empty")}
        </p>
      ) : (
        <div className="flex flex-col border border-border">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0"
            >
              <Switch
                checked={channel.enabled}
                onCheckedChange={(checked) => void toggle(channel, checked)}
                aria-label={t("channels.enabled")}
              />
              <span className="flex-1 min-w-0 text-sm truncate">
                {channel.name}
              </span>
              {!channel.usable && (
                <span
                  className="text-destructive"
                  title={t("channels.needsSave")}
                >
                  <AlertTriangle className="size-3.5" />
                </span>
              )}
              <Badge
                variant="outline"
                className="rounded-none text-[10px] uppercase"
              >
                {t(`channels.types.${channel.type}`)}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-none"
                title={t("channels.test")}
                aria-label={t("channels.test")}
                disabled={testing === channel.id}
                onClick={() => void test(channel)}
              >
                {testing === channel.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-none"
                title={t("channels.edit")}
                aria-label={t("channels.edit")}
                onClick={() => {
                  setEditingId(channel.id);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-none"
                title={t("actions.delete")}
                aria-label={t("actions.delete")}
                onClick={() => remove(channel)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ChannelDialog
        api={api}
        open={dialogOpen}
        channelId={editingId}
        emailAvailable={emailAvailable}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}
