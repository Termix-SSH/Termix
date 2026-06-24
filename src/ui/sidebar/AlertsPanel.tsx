import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  Plus,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  getAlertFirings,
  acknowledgeAlertFiring,
  acknowledgeAllAlertFirings,
  getAlertRules,
  getNotificationChannels,
  deleteAlertRule,
  deleteNotificationChannel,
  testNotificationChannel,
  type AlertFiring,
  type AlertRule,
  type NotificationChannel,
} from "@/api/alerts-api";
import { AlertRuleDialog } from "./AlertRuleDialog";
import { NotificationChannelDialog } from "./NotificationChannelDialog";

type PanelTab = "firings" | "rules" | "channels";

const SEVERITY_CLASS: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

function timeAgo(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function AlertsPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PanelTab>("firings");

  // Firings state
  const [firings, setFirings] = useState<AlertFiring[]>([]);
  const [firingsLoading, setFiringsLoading] = useState(true);
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  // Rules state
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);

  // Channels state
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(
    null,
  );

  const loadFirings = useCallback(() => {
    setFiringsLoading(true);
    getAlertFirings({ limit: 100 })
      .then(setFirings)
      .catch(() => {})
      .finally(() => setFiringsLoading(false));
  }, []);

  const loadRules = useCallback(() => {
    setRulesLoading(true);
    getAlertRules()
      .then(setRules)
      .catch(() => {})
      .finally(() => setRulesLoading(false));
  }, []);

  const loadChannels = useCallback(() => {
    setChannelsLoading(true);
    getNotificationChannels()
      .then(setChannels)
      .catch(() => {})
      .finally(() => setChannelsLoading(false));
  }, []);

  useEffect(() => {
    loadFirings();
  }, [loadFirings]);

  useEffect(() => {
    if (tab === "rules") loadRules();
    if (tab === "channels") loadChannels();
  }, [tab, loadRules, loadChannels]);

  const visibleFirings = firings.filter((f) =>
    showAcknowledged ? true : !f.acknowledged,
  );

  async function handleAck(id: number) {
    try {
      await acknowledgeAlertFiring(id);
      setFirings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, acknowledged: true } : f)),
      );
    } catch {
      toast.error(t("alerts.ackFailed", "Failed to acknowledge alert"));
    }
  }

  async function handleAckAll() {
    try {
      await acknowledgeAllAlertFirings();
      setFirings((prev) => prev.map((f) => ({ ...f, acknowledged: true })));
      toast.success(t("alerts.allAcknowledged", "All alerts acknowledged"));
    } catch {
      toast.error(t("alerts.ackAllFailed", "Failed to acknowledge all alerts"));
    }
  }

  async function handleDeleteRule(id: number) {
    if (!confirm(t("common.confirmDelete", "Delete this rule?"))) return;
    try {
      await deleteAlertRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success(t("common.deleted", "Deleted"));
    } catch {
      toast.error(t("common.deleteFailed", "Delete failed"));
    }
  }

  async function handleDeleteChannel(id: number) {
    if (!confirm(t("common.confirmDelete", "Delete this channel?"))) return;
    try {
      await deleteNotificationChannel(id);
      setChannels((prev) => prev.filter((c) => c.id !== id));
      toast.success(t("common.deleted", "Deleted"));
    } catch {
      toast.error(t("common.deleteFailed", "Delete failed"));
    }
  }

  async function handleTestChannel(id: number) {
    try {
      await testNotificationChannel(id);
      toast.success(t("alerts.testSent", "Test notification sent"));
    } catch {
      toast.error(t("alerts.testFailed", "Test notification failed"));
    }
  }

  const unreadCount = firings.filter((f) => !f.acknowledged).length;

  return (
    <div className="flex flex-col h-full">
      {/* Tab strip */}
      <div className="flex shrink-0 border-b border-border">
        {(["firings", "rules", "channels"] as PanelTab[]).map((t_) => (
          <button
            key={t_}
            onClick={() => setTab(t_)}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
              tab === t_
                ? "border-b-2 border-accent-brand text-accent-brand"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t_ === "firings"
              ? t("alerts.tabFirings", "Alerts")
              : t_ === "rules"
                ? t("alerts.tabRules", "Rules")
                : t("alerts.tabChannels", "Channels")}
            {t_ === "firings" && unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Firings tab */}
      {tab === "firings" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <button
              onClick={() => setShowAcknowledged((v) => !v)}
              className={`text-[10px] font-semibold px-2 py-1 border transition-colors ${showAcknowledged ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {showAcknowledged
                ? t("alerts.hideAcknowledged", "Hide Acked")
                : t("alerts.showAcknowledged", "Show All")}
            </button>
            <div className="flex-1" />
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={handleAckAll}
              >
                <CheckCheck className="size-3 mr-1" />
                {t("alerts.ackAll", "Ack All")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground"
              onClick={loadFirings}
              title={t("common.refresh", "Refresh")}
            >
              <Settings2 className="size-3" />
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {firingsLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {t("common.loading", "Loading...")}
              </div>
            )}
            {!firingsLoading && visibleFirings.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <BellOff className="size-8 opacity-40" />
                <span className="text-xs">
                  {t("alerts.noFirings", "No unacknowledged alerts")}
                </span>
              </div>
            )}
            {!firingsLoading &&
              visibleFirings.map((firing) => (
                <div
                  key={firing.id}
                  className={`flex flex-col gap-1 px-3 py-2.5 border-b border-border transition-colors ${firing.acknowledged ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 border ${SEVERITY_CLASS[firing.severity] ?? "bg-muted text-muted-foreground border-border"}`}
                    >
                      {firing.severity}
                    </span>
                    <span className="flex-1 truncate text-xs font-semibold">
                      {firing.hostName}
                    </span>
                    {!firing.acknowledged && (
                      <button
                        onClick={() => handleAck(firing.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        title={t("alerts.acknowledge", "Acknowledge")}
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] text-foreground/80">
                    {firing.message}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {firing.ruleName && <span>{firing.ruleName}</span>}
                    <span>{timeAgo(firing.firedAt)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Rules tab */}
      {tab === "rules" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <span className="flex-1 text-xs text-muted-foreground">
              {t("alerts.rulesDesc", "Alert rules trigger notifications")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => {
                setEditRule(null);
                setRuleDialogOpen(true);
              }}
            >
              <Plus className="size-3 mr-1" />
              {t("common.add", "Add")}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {rulesLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {t("common.loading", "Loading...")}
              </div>
            )}
            {!rulesLoading && rules.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <Bell className="size-8 opacity-40" />
                <span className="text-xs">
                  {t("alerts.noRules", "No alert rules configured")}
                </span>
              </div>
            )}
            {!rulesLoading &&
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {rule.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {rule.triggerType.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div
                    className={`size-2 shrink-0 rounded-full ${rule.enabled ? "bg-green-500" : "bg-muted"}`}
                  />
                  <button
                    onClick={() => {
                      setEditRule(rule);
                      setRuleDialogOpen(true);
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title={t("common.edit", "Edit")}
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title={t("common.delete", "Delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Channels tab */}
      {tab === "channels" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <span className="flex-1 text-xs text-muted-foreground">
              {t("alerts.channelsDesc", "Where alert notifications are sent")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => {
                setEditChannel(null);
                setChannelDialogOpen(true);
              }}
            >
              <Plus className="size-3 mr-1" />
              {t("common.add", "Add")}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {channelsLoading && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {t("common.loading", "Loading...")}
              </div>
            )}
            {!channelsLoading && channels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <Bell className="size-8 opacity-40" />
                <span className="text-xs">
                  {t(
                    "alerts.noChannels",
                    "No notification channels configured",
                  )}
                </span>
              </div>
            )}
            {!channelsLoading &&
              channels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {channel.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">
                      {channel.type}
                    </div>
                  </div>
                  <div
                    className={`size-2 shrink-0 rounded-full ${channel.enabled ? "bg-green-500" : "bg-muted"}`}
                  />
                  <button
                    onClick={() => handleTestChannel(channel.id)}
                    className="shrink-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground border border-border px-1.5 py-0.5"
                    title={t("alerts.test", "Test")}
                  >
                    {t("alerts.test", "Test")}
                  </button>
                  <button
                    onClick={() => {
                      setEditChannel(channel);
                      setChannelDialogOpen(true);
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title={t("common.edit", "Edit")}
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteChannel(channel.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title={t("common.delete", "Delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      <AlertRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        rule={editRule}
        channels={channels}
        onSaved={() => {
          setRuleDialogOpen(false);
          loadRules();
        }}
      />

      <NotificationChannelDialog
        open={channelDialogOpen}
        onOpenChange={setChannelDialogOpen}
        channel={editChannel}
        onSaved={() => {
          setChannelDialogOpen(false);
          loadChannels();
        }}
      />
    </div>
  );
}
