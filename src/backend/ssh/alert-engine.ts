import { getDb } from "../database/db/index.js";
import { statsLogger } from "../utils/logger.js";
import {
  sendNotification,
  type AlertPayload,
  type NotificationChannel,
} from "../utils/notification-sender.js";

type AlertTriggerType =
  | "host_offline"
  | "host_online"
  | "cpu_threshold"
  | "memory_threshold"
  | "disk_threshold"
  | "health_check_failure"
  | "health_check_recovery"
  | "user_login";

interface AlertRule {
  id: number;
  userId: string;
  hostId: number | null;
  name: string;
  enabled: boolean;
  triggerType: AlertTriggerType;
  thresholdValue: number | null;
  thresholdDurationSeconds: number | null;
  cooldownMinutes: number;
}

interface RawRule {
  id: number;
  user_id: string;
  host_id: number | null;
  name: string;
  enabled: number;
  trigger_type: string;
  threshold_value: number | null;
  threshold_duration_seconds: number | null;
  cooldown_minutes: number;
}

interface RawChannel {
  id: number;
  type: string;
  config: string;
  enabled: number;
}

export class AlertEngine {
  private static instance: AlertEngine;

  // "${ruleId}:${hostId}" → lastFiredAt ms
  private cooldownMap = new Map<string, number>();
  // "${ruleId}:${hostId}" → breachStartTime ms
  private breachStartMap = new Map<string, number>();
  // hostId → last known status
  private lastStatusMap = new Map<number, "online" | "offline">();
  // "${hostId}:${checkId}" → last known ok state
  private healthCheckStateMap = new Map<string, boolean>();

  static getInstance(): AlertEngine {
    if (!AlertEngine.instance) {
      AlertEngine.instance = new AlertEngine();
    }
    return AlertEngine.instance;
  }

  async evaluateMetrics(
    hostId: number,
    metrics: {
      cpu?: { percent: number | null } | null;
      memory?: { percent: number | null } | null;
      disk?: { percent: number | null } | null;
    },
  ): Promise<void> {
    const rules = this.loadRulesForHost(hostId).filter((r) =>
      ["cpu_threshold", "memory_threshold", "disk_threshold"].includes(
        r.triggerType,
      ),
    );

    if (rules.length === 0) return;

    const now = Date.now();

    for (const rule of rules) {
      let currentValue: number | null | undefined;
      if (rule.triggerType === "cpu_threshold")
        currentValue = metrics.cpu?.percent;
      else if (rule.triggerType === "memory_threshold")
        currentValue = metrics.memory?.percent;
      else if (rule.triggerType === "disk_threshold")
        currentValue = metrics.disk?.percent;

      if (currentValue == null || rule.thresholdValue == null) continue;

      const key = `${rule.id}:${hostId}`;
      const isBreaching = currentValue >= rule.thresholdValue;

      if (isBreaching) {
        if (!this.breachStartMap.has(key)) {
          this.breachStartMap.set(key, now);
        }
        const breachStart = this.breachStartMap.get(key)!;
        const durationMs = (rule.thresholdDurationSeconds ?? 0) * 1000;
        if (
          now - breachStart >= durationMs &&
          !this.isCoolingDown(rule.id, hostId)
        ) {
          const hostName = this.getHostName(hostId);
          await this.fireAlert(rule, hostId, hostName, {
            value: currentValue,
            message: `${rule.triggerType.replace("_threshold", "").toUpperCase()} usage at ${currentValue.toFixed(1)}% (threshold: ${rule.thresholdValue}%)`,
            severity: currentValue >= 95 ? "critical" : "warning",
          });
        }
      } else {
        this.breachStartMap.delete(key);
      }
    }
  }

  async evaluateStatus(hostId: number, isOnline: boolean): Promise<void> {
    const currentStatus = isOnline ? "online" : "offline";
    const lastStatus = this.lastStatusMap.get(hostId);

    if (lastStatus === currentStatus) return;
    this.lastStatusMap.set(hostId, currentStatus);

    if (lastStatus === undefined) return;

    const triggerType: AlertTriggerType = isOnline
      ? "host_online"
      : "host_offline";
    const rules = this.loadRulesForHost(hostId).filter(
      (r) => r.triggerType === triggerType,
    );

    for (const rule of rules) {
      if (!this.isCoolingDown(rule.id, hostId)) {
        const hostName = this.getHostName(hostId);
        await this.fireAlert(rule, hostId, hostName, {
          message: isOnline
            ? `Host "${hostName}" is back online`
            : `Host "${hostName}" is offline`,
          severity: isOnline ? "info" : "critical",
        });
      }
    }
  }

  async evaluateHealthCheck(
    hostId: number,
    userId: string,
    checkId: string,
    ok: boolean,
    detail?: string,
  ): Promise<void> {
    const stateKey = `${hostId}:${checkId}`;
    const lastOk = this.healthCheckStateMap.get(stateKey);
    this.healthCheckStateMap.set(stateKey, ok);

    if (lastOk === undefined) return;

    let triggerType: AlertTriggerType | null = null;
    if (!ok && lastOk) triggerType = "health_check_failure";
    else if (ok && !lastOk) triggerType = "health_check_recovery";

    if (!triggerType) return;

    const rules = this.loadRulesForHostUser(hostId, userId).filter(
      (r) => r.triggerType === triggerType,
    );

    for (const rule of rules) {
      if (!this.isCoolingDown(rule.id, hostId)) {
        const hostName = this.getHostName(hostId);
        await this.fireAlert(rule, hostId, hostName, {
          message: ok
            ? `Health check recovered on "${hostName}"${detail ? `: ${detail}` : ""}`
            : `Health check failed on "${hostName}"${detail ? `: ${detail}` : ""}`,
          severity: ok ? "info" : "warning",
        });
      }
    }
  }

  async evaluateUserLogin(
    hostId: number,
    userId: string,
    sshUser: string,
    fromIp: string,
  ): Promise<void> {
    const rules = this.loadRulesForHostUser(hostId, userId).filter(
      (r) => r.triggerType === "user_login",
    );

    for (const rule of rules) {
      if (!this.isCoolingDown(rule.id, hostId)) {
        const hostName = this.getHostName(hostId);
        await this.fireAlert(rule, hostId, hostName, {
          message: `User "${sshUser}" logged in to "${hostName}" from ${fromIp}`,
          severity: "info",
        });
      }
    }
  }

  private async fireAlert(
    rule: AlertRule,
    hostId: number,
    hostName: string,
    context: {
      value?: number;
      message: string;
      severity: "info" | "warning" | "critical";
    },
  ): Promise<void> {
    this.markCooldown(rule.id, hostId);

    const payload: AlertPayload = {
      hostName,
      hostId,
      triggerType: rule.triggerType,
      value: context.value,
      threshold: rule.thresholdValue ?? undefined,
      message: context.message,
      severity: context.severity,
      timestamp: new Date().toISOString(),
      ruleId: rule.id,
      ruleName: rule.name,
    };

    try {
      const db = getDb();
      db.$client
        .prepare(
          `INSERT INTO alert_firings (user_id, rule_id, host_id, host_name, value, message, severity)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rule.userId,
          rule.id,
          hostId,
          hostName,
          context.value ?? null,
          context.message,
          context.severity,
        );

      // Prune old firings beyond 30 days
      db.$client
        .prepare(
          `DELETE FROM alert_firings WHERE user_id = ? AND fired_at < datetime('now', '-30 days')`,
        )
        .run(rule.userId);
    } catch (err) {
      statsLogger.warn("Failed to write alert firing", {
        operation: "alert_firing_insert_error",
        ruleId: rule.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const channels = this.loadChannelsForRule(rule.id);
    for (const channel of channels) {
      sendNotification(channel, payload).catch((err) => {
        statsLogger.warn("Failed to send notification", {
          operation: "notification_delivery_error",
          channelId: channel.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  private isCoolingDown(ruleId: number, hostId: number): boolean {
    const key = `${ruleId}:${hostId}`;
    const lastFired = this.cooldownMap.get(key);
    if (!lastFired) return false;
    const rule = this.loadRuleById(ruleId);
    const cooldownMs = (rule?.cooldownMinutes ?? 15) * 60 * 1000;
    return Date.now() - lastFired < cooldownMs;
  }

  private markCooldown(ruleId: number, hostId: number): void {
    this.cooldownMap.set(`${ruleId}:${hostId}`, Date.now());
  }

  private loadRulesForHost(hostId: number): AlertRule[] {
    try {
      const db = getDb();
      const rows = db.$client
        .prepare(
          `SELECT * FROM alert_rules
           WHERE enabled = 1 AND (host_id = ? OR host_id IS NULL)`,
        )
        .all(hostId) as RawRule[];
      return rows.map(mapRawRule);
    } catch {
      return [];
    }
  }

  private loadRulesForHostUser(hostId: number, userId: string): AlertRule[] {
    try {
      const db = getDb();
      const rows = db.$client
        .prepare(
          `SELECT * FROM alert_rules
           WHERE enabled = 1 AND user_id = ? AND (host_id = ? OR host_id IS NULL)`,
        )
        .all(userId, hostId) as RawRule[];
      return rows.map(mapRawRule);
    } catch {
      return [];
    }
  }

  private loadRuleById(ruleId: number): AlertRule | null {
    try {
      const db = getDb();
      const row = db.$client
        .prepare("SELECT * FROM alert_rules WHERE id = ?")
        .get(ruleId) as RawRule | undefined;
      return row ? mapRawRule(row) : null;
    } catch {
      return null;
    }
  }

  private loadChannelsForRule(ruleId: number): NotificationChannel[] {
    try {
      const db = getDb();
      const rows = db.$client
        .prepare(
          `SELECT nc.id, nc.type, nc.config, nc.enabled
           FROM notification_channels nc
           JOIN alert_rule_channels arc ON arc.channel_id = nc.id
           WHERE arc.rule_id = ? AND nc.enabled = 1`,
        )
        .all(ruleId) as RawChannel[];
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        config: r.config,
        enabled: r.enabled === 1,
      }));
    } catch {
      return [];
    }
  }

  private getHostName(hostId: number): string {
    try {
      const db = getDb();
      const row = db.$client
        .prepare("SELECT name, ip FROM ssh_data WHERE id = ?")
        .get(hostId) as { name: string | null; ip: string } | undefined;
      return row?.name || row?.ip || `Host #${hostId}`;
    } catch {
      return `Host #${hostId}`;
    }
  }
}

function mapRawRule(r: RawRule): AlertRule {
  return {
    id: r.id,
    userId: r.user_id,
    hostId: r.host_id,
    name: r.name,
    enabled: r.enabled === 1,
    triggerType: r.trigger_type as AlertTriggerType,
    thresholdValue: r.threshold_value,
    thresholdDurationSeconds: r.threshold_duration_seconds,
    cooldownMinutes: r.cooldown_minutes,
  };
}
