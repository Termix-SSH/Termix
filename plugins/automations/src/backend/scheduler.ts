import type { PluginLogger } from "@termix/plugin-sdk/backend";
import type { AutomationDefinition } from "../types.js";
import { computeNextDueAt } from "./cron.js";
import { hasDwelled, isCoolingDown } from "./conditions.js";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository } from "./repository.js";

/**
 * The one tick the automations plugin runs. It handles due schedules, dwell
 * windows that need re-checking without a fresh sample, the watchers that
 * keep metrics and Docker events flowing for watched hosts, and history
 * pruning. activate() drives it through ctx.schedule.
 */

export const TICK_MS = 15_000;
export const STARTUP_DELAY_MS = 30_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RUN_RETENTION_DAYS = 30;
/** A "running" row older than this belongs to a process that is gone. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

export interface SchedulerDeps {
  repository: AutomationRepository;
  engine: Pick<AutomationEngine, "run">;
  log: PluginLogger;
  /** Watchers brought in line with the enabled automations every tick. */
  reconcile: Array<(now: number) => Promise<unknown>>;
}

export function createScheduler(deps: SchedulerDeps) {
  const { repository, engine, log } = deps;
  let lastPruneAt = 0;
  let ticking = false;

  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  async function runDueSchedules(now: Date): Promise<void> {
    const due = await repository.listDueSchedules(now.toISOString());

    for (const schedule of due) {
      const nextDueAt = computeNextDueAt(
        {
          cron: schedule.cron,
          intervalSeconds: schedule.intervalSeconds,
          timezone: schedule.timezone,
        },
        now,
      );
      await repository.markScheduleTicked(
        schedule.automationId,
        nextDueAt,
        now.toISOString(),
      );

      void engine
        .run({
          automationId: schedule.automationId,
          triggerType: "schedule",
          triggerContext: { scheduledFor: now.toISOString() },
        })
        .catch((error: unknown) =>
          log.warn(
            `Scheduled automation ${schedule.automationId} failed to start: ${errorText(error)}`,
          ),
        );
    }
  }

  /**
   * Fires sustained breaches whose window has elapsed. Without this a dwell
   * window only completes when another sample happens to arrive.
   */
  async function recheckOpenBreaches(now: Date): Promise<void> {
    const open = await repository.listOpenBreaches();
    const nowMs = now.getTime();

    for (const state of open) {
      const automation = await repository.findById(state.automationId);
      if (!automation || !automation.enabled) continue;

      let definition: AutomationDefinition;
      try {
        definition = JSON.parse(automation.definition) as AutomationDefinition;
      } catch {
        continue;
      }

      const trigger = definition.trigger;
      if (trigger?.kind !== "metric_threshold") continue;
      if (!trigger.forSeconds) continue;
      if (!hasDwelled(state.breachStartedAt, trigger.forSeconds, nowMs)) {
        continue;
      }
      if (isCoolingDown(state.lastFiredAt, trigger.cooldownMinutes, nowMs)) {
        continue;
      }

      const hostId = Number(state.stateKey.split(":")[0]);
      await repository.upsertTriggerState({
        automationId: automation.id,
        stateKey: state.stateKey,
        lastFiredAt: now.toISOString(),
      });

      void engine
        .run({
          automationId: automation.id,
          triggerType: "metric_threshold",
          triggerContext: {
            hostId,
            value: state.lastValue,
            threshold: trigger.value,
            metric: trigger.metric.path,
            sustained: true,
          },
          triggerHostId: Number.isFinite(hostId) ? hostId : undefined,
        })
        .catch(() => undefined);
    }
  }

  async function pruneIfDue(now: Date): Promise<void> {
    if (now.getTime() - lastPruneAt < PRUNE_INTERVAL_MS) return;
    lastPruneAt = now.getTime();
    try {
      await repository.failStaleRunningRuns(
        new Date(now.getTime() - STALE_RUN_MS).toISOString(),
      );
      const deleted = await repository.pruneRunsOlderThan(RUN_RETENTION_DAYS);
      if (deleted > 0) log.info(`Pruned ${deleted} old automation run(s)`);
    } catch (error) {
      log.warn(`Automation run pruning failed: ${errorText(error)}`);
    }
  }

  return {
    async tick(now: Date = new Date()): Promise<void> {
      // A slow tick must not overlap the next one.
      if (ticking) return;
      ticking = true;
      try {
        for (const reconcile of deps.reconcile) {
          await reconcile(now.getTime()).catch((error: unknown) =>
            log.warn(`Automation watcher failed: ${errorText(error)}`),
          );
        }
        await runDueSchedules(now);
        await recheckOpenBreaches(now);
        await pruneIfDue(now);
      } catch (error) {
        log.warn(`Automation scheduler tick failed: ${errorText(error)}`);
      } finally {
        ticking = false;
      }
    },
  };
}
