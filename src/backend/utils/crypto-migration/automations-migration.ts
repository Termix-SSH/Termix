import type {
  AutomationDefinition,
  Step,
  Trigger,
} from "../../../types/automations.js";
import { AUTOMATION_DEFINITION_VERSION } from "../../../types/automations.js";
import { databaseLogger } from "../logger.js";
import {
  createCurrentAutomationRepository,
  createCurrentRepositoryContext,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import { alertRuleChannels, alertRules } from "../../database/db/schema.js";
import { eq } from "drizzle-orm";

const MIGRATION_FLAG = "alert_rules_to_automations_v1";

export interface AutomationsMigrationResult {
  migrated: number;
  skipped: number;
}

/**
 * Carries existing alert rules over into automations.
 *
 * Each rule becomes an automation whose trigger is the rule's threshold or
 * state change and whose only step notifies the channels that rule was linked
 * to, which is exactly what the alert engine did with it.
 *
 * The alert_* tables are deliberately left in place. They are the rollback
 * path, and alert_firings is user-visible history; nothing writes to them once
 * the automations engine takes over.
 */
export async function runAutomationsMigration(): Promise<AutomationsMigrationResult | null> {
  const settingsRepository = createCurrentSettingsRepository();

  try {
    if ((await settingsRepository.get(MIGRATION_FLAG)) === "done") {
      // Already migrated on an earlier boot; the automations engine owns
      // evaluation from here, so the old one must stay quiet.
      await standDownAlertEngine();
      return null;
    }

    const { drizzle } = createCurrentRepositoryContext();
    const rules = await drizzle.select().from(alertRules);

    if (rules.length === 0) {
      await settingsRepository.set(MIGRATION_FLAG, "done");
      await standDownAlertEngine();
      return { migrated: 0, skipped: 0 };
    }

    const repository = createCurrentAutomationRepository();
    let migrated = 0;
    let skipped = 0;

    for (const rule of rules) {
      const trigger = triggerForRule(rule);
      if (!trigger) {
        skipped++;
        continue;
      }

      const links = await drizzle
        .select({ channelId: alertRuleChannels.channelId })
        .from(alertRuleChannels)
        .where(eq(alertRuleChannels.ruleId, rule.id));
      const channelIds = links.map((link) => link.channelId);

      const steps: Step[] = [
        {
          id: "notify",
          type: "notify",
          channelIds,
          title: `${rule.name}`,
          body: messageTemplateFor(rule.triggerType),
          severity: "warning",
        },
      ];

      const definition: AutomationDefinition = {
        version: AUTOMATION_DEFINITION_VERSION,
        trigger,
        steps,
      };

      await repository.create({
        userId: rule.userId,
        name: rule.name,
        description: "Migrated from an alert rule",
        enabled: !!rule.enabled,
        definition: JSON.stringify(definition),
        channels: channelIds,
      });
      migrated++;
    }

    await settingsRepository.set(MIGRATION_FLAG, "done");
    await standDownAlertEngine();

    if (migrated > 0) {
      databaseLogger.info(`Migrated ${migrated} alert rule(s) to automations`, {
        operation: "automations_migration",
        migrated,
        skipped,
      });
    }

    return { migrated, skipped };
  } catch (error) {
    databaseLogger.warn("Alert rule migration failed", {
      operation: "automations_migration_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Imported lazily: this migration runs before the metrics subsystem is loaded,
 * and pulling that module in early would drag its timers in with it.
 */
async function standDownAlertEngine(): Promise<void> {
  try {
    const { markAlertEngineSuperseded } =
      await import("../../hosts/metrics/alert-engine.js");
    markAlertEngineSuperseded();
  } catch {
    // If it cannot be loaded there is nothing running to stand down.
  }
}

type AlertRuleRecord = typeof alertRules.$inferSelect;

function triggerForRule(rule: AlertRuleRecord): Trigger | null {
  const hostSelector =
    rule.hostId === null
      ? ({ kind: "all" } as const)
      : ({ kind: "host", hostId: rule.hostId } as const);
  const cooldownMinutes = rule.cooldownMinutes ?? 15;

  switch (rule.triggerType) {
    case "cpu_threshold":
    case "memory_threshold":
    case "disk_threshold": {
      const path =
        rule.triggerType === "cpu_threshold"
          ? "cpu.percent"
          : rule.triggerType === "memory_threshold"
            ? "memory.percent"
            : "disk.percent";
      return {
        kind: "metric_threshold",
        hostSelector,
        metric: { path } as Extract<
          Trigger,
          { kind: "metric_threshold" }
        >["metric"],
        // The old engine only ever compared with >=.
        operator: ">=",
        value: rule.thresholdValue ?? 0,
        forSeconds: rule.thresholdDurationSeconds ?? undefined,
        cooldownMinutes,
      };
    }
    case "host_offline":
      return {
        kind: "host_status",
        hostSelector,
        to: "offline",
        cooldownMinutes,
      };
    case "host_online":
      return {
        kind: "host_status",
        hostSelector,
        to: "online",
        cooldownMinutes,
      };
    case "health_check_failure":
      return {
        kind: "health_check",
        hostSelector,
        to: "failing",
        cooldownMinutes,
      };
    case "health_check_recovery":
      return {
        kind: "health_check",
        hostSelector,
        to: "recovered",
        cooldownMinutes,
      };
    case "user_login":
      return {
        kind: "internal_event",
        event: "user_login",
        hostSelector,
        cooldownMinutes,
      };
    default:
      return null;
  }
}

function messageTemplateFor(triggerType: string): string {
  if (triggerType.endsWith("_threshold")) {
    return "{{trigger.metric}} on host {{trigger.hostId}} is at {{trigger.value}} (threshold {{trigger.threshold}})";
  }
  if (triggerType.startsWith("host_")) {
    return "Host {{trigger.hostId}} is {{trigger.status}}";
  }
  if (triggerType.startsWith("health_check")) {
    return "Health check {{trigger.checkId}} on host {{trigger.hostId}} is {{trigger.state}}";
  }
  return "Triggered on host {{trigger.hostId}}";
}
