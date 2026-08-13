import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import type { Trigger, TriggerKind } from "@/types/automations";
import { HostSelectorField } from "./HostSelectorField";
import type { AutomationEditorOptions } from "./editor-types";

const TRIGGER_KINDS: TriggerKind[] = [
  "metric_threshold",
  "host_status",
  "health_check",
  "schedule",
  "docker_event",
  "webhook",
];

const METRIC_PATHS = [
  "cpu.percent",
  "memory.percent",
  "disk.percent",
  "temperature.highestCelsius",
  "cpu.load1",
  "processes.total",
  "network.rxRateBps",
  "network.txRateBps",
];

/** The single trigger at the top of an automation. */
export function TriggerCard({
  trigger,
  options,
  onChange,
}: {
  trigger: Trigger;
  options: AutomationEditorOptions;
  onChange: (next: Trigger) => void;
}) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";

  function patch(changes: Record<string, unknown>) {
    onChange({ ...trigger, ...changes } as Trigger);
  }

  return (
    <div className="border border-border p-3 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {t(`${base}.trigger`)}
        </Label>
        <Select
          value={trigger.kind}
          onValueChange={(value) =>
            onChange(defaultTrigger(value as TriggerKind))
          }
        >
          <SelectTrigger size="sm" className="rounded-none border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`${base}.triggerKinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {trigger.kind === "metric_threshold" && (
        <>
          <HostSelectorField
            value={trigger.hostSelector}
            options={options}
            allowTrigger={false}
            onChange={(hostSelector) => patch({ hostSelector })}
          />
          <div className="flex gap-2">
            <Select
              value={trigger.metric?.path ?? "cpu.percent"}
              onValueChange={(value) =>
                patch({ metric: { ...trigger.metric, path: value } })
              }
            >
              <SelectTrigger
                size="sm"
                className="flex-1 rounded-none border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRIC_PATHS.map((path) => (
                  <SelectItem key={path} value={path}>
                    {path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={trigger.operator}
              onValueChange={(value) => patch({ operator: value })}
            >
              <SelectTrigger
                size="sm"
                className="w-20 rounded-none border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[">", ">=", "<", "<=", "==", "!="].map((op) => (
                  <SelectItem key={op} value={op}>
                    {op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              className="h-8 w-24 rounded-none border-border"
              value={trigger.value ?? 0}
              onChange={(e) => patch({ value: Number(e.target.value) })}
            />
          </div>

          {trigger.metric?.path === "disk.percent" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t(`${base}.fields.mount`)}
              </Label>
              <Input
                className="h-8 rounded-none border-border font-mono text-xs"
                placeholder="/data"
                value={trigger.metric?.mount ?? ""}
                onChange={(e) =>
                  patch({
                    metric: {
                      ...trigger.metric,
                      mount: e.target.value || undefined,
                    },
                  })
                }
              />
            </div>
          )}

          {trigger.metric?.path.startsWith("network.") && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t(`${base}.fields.interface`)}
              </Label>
              <Input
                className="h-8 rounded-none border-border font-mono text-xs"
                placeholder="eth0"
                value={trigger.metric.iface ?? ""}
                onChange={(e) =>
                  patch({
                    metric: {
                      ...trigger.metric,
                      iface: e.target.value || undefined,
                    },
                  })
                }
              />
            </div>
          )}

          <div className="flex gap-2">
            <NumberField
              label={t(`${base}.fields.forSeconds`)}
              value={trigger.forSeconds ?? 0}
              onChange={(value) => patch({ forSeconds: value })}
            />
            <NumberField
              label={t(`${base}.fields.cooldown`)}
              value={trigger.cooldownMinutes ?? 15}
              onChange={(value) => patch({ cooldownMinutes: value })}
            />
          </div>
        </>
      )}

      {(trigger.kind === "host_status" || trigger.kind === "health_check") && (
        <>
          <HostSelectorField
            value={trigger.hostSelector}
            options={options}
            allowTrigger={false}
            onChange={(hostSelector) => patch({ hostSelector })}
          />
          <Select
            value={trigger.to}
            onValueChange={(value) => patch({ to: value })}
          >
            <SelectTrigger size="sm" className="rounded-none border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {trigger.kind === "host_status" ? (
                <>
                  <SelectItem value="offline">offline</SelectItem>
                  <SelectItem value="online">online</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="failing">failing</SelectItem>
                  <SelectItem value="recovered">recovered</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          <NumberField
            label={t(`${base}.fields.cooldown`)}
            value={trigger.cooldownMinutes ?? 15}
            onChange={(value) => patch({ cooldownMinutes: value })}
          />
        </>
      )}

      {trigger.kind === "schedule" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t(`${base}.fields.cron`)}
            </Label>
            <Input
              className="h-8 rounded-none border-border font-mono text-xs"
              placeholder="0 2 * * *"
              value={trigger.cron ?? ""}
              onChange={(e) =>
                patch({ cron: e.target.value, intervalSeconds: undefined })
              }
            />
          </div>
          <NumberField
            label={t(`${base}.fields.intervalSeconds`)}
            value={trigger.intervalSeconds ?? 0}
            onChange={(value) =>
              patch({ intervalSeconds: value || undefined, cron: undefined })
            }
          />
        </div>
      )}

      {trigger.kind === "docker_event" && (
        <>
          <HostSelectorField
            value={trigger.hostSelector}
            options={options}
            allowTrigger={false}
            onChange={(hostSelector) => patch({ hostSelector })}
          />
          <div className="flex gap-2">
            <Input
              className="h-8 flex-1 rounded-none border-border"
              placeholder={t(`${base}.fields.container`)}
              value={trigger.container ?? ""}
              onChange={(e) => patch({ container: e.target.value })}
            />
            <Select
              value={trigger.event}
              onValueChange={(value) => patch({ event: value })}
            >
              <SelectTrigger
                size="sm"
                className="min-w-0 flex-1 rounded-none border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["exited", "started", "unhealthy", "restarting"].map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {trigger.kind === "webhook" && (
        <p className="text-xs text-muted-foreground">
          {t(`${base}.webhookTokenDescription`)}
        </p>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1 flex-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        className="h-8 rounded-none border-border"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case "host_status":
      return {
        kind: "host_status",
        hostSelector: { kind: "all" },
        to: "offline",
        cooldownMinutes: 15,
      };
    case "health_check":
      return {
        kind: "health_check",
        hostSelector: { kind: "all" },
        to: "failing",
        cooldownMinutes: 15,
      };
    case "schedule":
      return { kind: "schedule", cron: "0 2 * * *" };
    case "docker_event":
      return {
        kind: "docker_event",
        hostSelector: { kind: "all" },
        event: "exited",
        cooldownMinutes: 15,
      };
    case "webhook":
      return { kind: "webhook", tokenHash: "" };
    default:
      return {
        kind: "metric_threshold",
        hostSelector: { kind: "all" },
        metric: { path: "cpu.percent" },
        operator: ">",
        value: 90,
        forSeconds: 300,
        cooldownMinutes: 15,
      };
  }
}
