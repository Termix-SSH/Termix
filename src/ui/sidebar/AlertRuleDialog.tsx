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
  createAlertRule,
  updateAlertRule,
  type AlertRule,
  type NotificationChannel,
} from "@/api/alerts-api";

const TRIGGER_TYPES = [
  { value: "host_offline", label: "Host Offline", hasThreshold: false },
  { value: "host_online", label: "Host Online", hasThreshold: false },
  { value: "cpu_threshold", label: "CPU Usage Threshold", hasThreshold: true },
  {
    value: "memory_threshold",
    label: "Memory Usage Threshold",
    hasThreshold: true,
  },
  {
    value: "disk_threshold",
    label: "Disk Usage Threshold",
    hasThreshold: true,
  },
  {
    value: "health_check_failure",
    label: "Health Check Failure",
    hasThreshold: false,
  },
  { value: "user_login", label: "User SSH Login", hasThreshold: false },
];

interface AlertRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: AlertRule | null;
  channels: NotificationChannel[];
  onSaved: () => void;
}

export function AlertRuleDialog({
  open,
  onOpenChange,
  rule,
  channels,
  onSaved,
}: AlertRuleDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("host_offline");
  const [threshold, setThreshold] = useState("80");
  const [durationSeconds, setDurationSeconds] = useState("0");
  const [cooldownMinutes, setCooldownMinutes] = useState("15");
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const triggerDef = TRIGGER_TYPES.find((tt) => tt.value === triggerType);
  const hasThreshold = triggerDef?.hasThreshold ?? false;

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setTriggerType(rule.triggerType);
      setThreshold(
        rule.thresholdValue != null ? String(rule.thresholdValue) : "80",
      );
      setDurationSeconds(
        rule.thresholdDurationSeconds != null
          ? String(rule.thresholdDurationSeconds)
          : "0",
      );
      setCooldownMinutes(String(rule.cooldownMinutes));
      setSelectedChannels(rule.channelIds ?? []);
    } else {
      setName("");
      setTriggerType("host_offline");
      setThreshold("80");
      setDurationSeconds("0");
      setCooldownMinutes("15");
      setSelectedChannels([]);
    }
  }, [open, rule]);

  function toggleChannel(id: number) {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("alerts.ruleNameRequired", "Name is required"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        triggerType,
        thresholdValue: hasThreshold ? Number(threshold) : null,
        thresholdDurationSeconds:
          hasThreshold && Number(durationSeconds) > 0
            ? Number(durationSeconds)
            : null,
        cooldownMinutes: Number(cooldownMinutes) || 15,
        channels: selectedChannels,
      };
      if (rule) {
        await updateAlertRule(rule.id, payload);
      } else {
        await createAlertRule(payload);
      }
      onSaved();
    } catch {
      toast.error(t("alerts.ruleSaveFailed", "Failed to save rule"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? t("alerts.editRule", "Edit Alert Rule")
              : t("alerts.addRule", "Add Alert Rule")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.ruleName", "Rule Name")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.triggerType", "Trigger")}
            </label>
            <div className="flex flex-col gap-1">
              {TRIGGER_TYPES.map((tt) => (
                <button
                  key={tt.value}
                  onClick={() => setTriggerType(tt.value)}
                  className={`flex items-center gap-2 px-2 py-1.5 text-xs border transition-colors text-left ${triggerType === tt.value ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <span
                    className={`size-2 shrink-0 rounded-full border-2 ${triggerType === tt.value ? "border-accent-brand bg-accent-brand" : "border-muted-foreground"}`}
                  />
                  {tt.label}
                </button>
              ))}
            </div>
          </div>

          {hasThreshold && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("alerts.thresholdValue", "Threshold (%)")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t(
                    "alerts.durationSeconds",
                    "Duration (seconds, 0 = fire immediately)",
                  )}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value)}
                  className="w-24 text-sm"
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.cooldownMinutes", "Cooldown (minutes)")}
            </label>
            <Input
              type="number"
              min={0}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
              className="w-24 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("alerts.channels", "Notification Channels")}
            </label>
            {channels.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">
                {t(
                  "alerts.noChannelsHint",
                  "Add channels in the Channels tab first",
                )}
              </span>
            ) : (
              <div className="flex flex-col gap-1">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => toggleChannel(ch.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 text-xs border transition-colors text-left ${selectedChannels.includes(ch.id) ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-sm border-2 ${selectedChannels.includes(ch.id) ? "border-accent-brand bg-accent-brand" : "border-muted-foreground"}`}
                    />
                    {ch.name}
                    <span className="ml-auto text-[9px] font-mono uppercase opacity-60">
                      {ch.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
