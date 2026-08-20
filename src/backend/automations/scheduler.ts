import type { AutomationDefinition } from "../../types/automations.js";
import { createCurrentAutomationRepository } from "../database/repositories/factory.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { statsLogger } from "../utils/logger.js";
import { computeNextDueAt } from "./cron.js";
import { hasDwelled, isCoolingDown } from "./conditions.js";
import { pollDockerEvents } from "./docker-watcher.js";
import { AutomationEngine } from "./engine.js";
import { reconcileHeadlessViewers } from "./headless-viewer.js";

/**
 * The one timer the automations feature owns.
 *
 * Every other periodic job in the backend is its own module-level setInterval;
 * this deliberately is not one per automation. A single tick handles due
 * schedules, dwell windows that need re-checking without a fresh sample, the
 * synthetic viewer heartbeat, and history pruning.
 */

const TICK_MS = 15_000;
const STARTUP_DELAY_MS = 30_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RUN_RETENTION_DAYS = 30;
/** A "running" row older than this belongs to a process that is gone. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

let tickTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let lastPruneAt = 0;
let ticking = false;

export function startAutomationScheduler(): void {
  if (tickTimer) return;

  startupTimer = setTimeout(() => {
    void tick();
  }, STARTUP_DELAY_MS);
  startupTimer.unref?.();

  tickTimer = setInterval(() => {
    void tick();
  }, TICK_MS);
  tickTimer.unref?.();
}

export function stopAutomationScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (startupTimer) clearTimeout(startupTimer);
  tickTimer = null;
  startupTimer = null;
}

/** Exposed for tests; the interval calls this. */
export async function tick(now: Date = new Date()): Promise<void> {
  // A slow tick must not overlap the next one.
  if (ticking) return;
  ticking = true;

  try {
    await reconcileHeadlessViewers().catch(() => undefined);
    await runDueSchedules(now);
    await recheckOpenBreaches(now);
    await pollDockerEvents(now.getTime()).catch(() => undefined);
    await pruneIfDue(now);
  } catch (error) {
    statsLogger.warn("Automation scheduler tick failed", {
      operation: "automation_scheduler_tick_error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    ticking = false;
  }
}

async function runDueSchedules(now: Date): Promise<void> {
  const repository = createCurrentAutomationRepository();
  const due = await repository.listDueSchedules(now.toISOString());

  for (const schedule of due) {
    const automation = await repository.findById(schedule.automationId);
    if (!automation) continue;

    // Background work can only touch a user's data while their key resolves.
    if (!canAccess(automation.userId)) {
      statsLogger.warn("Skipping scheduled automation: data key unavailable", {
        operation: "automation_schedule_locked",
        automationId: automation.id,
      });
      continue;
    }

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

    AutomationEngine.getInstance()
      .run({
        automationId: schedule.automationId,
        triggerType: "schedule",
        triggerContext: { scheduledFor: now.toISOString() },
      })
      .catch((error) => {
        statsLogger.warn("Scheduled automation failed to start", {
          operation: "automation_schedule_error",
          automationId: schedule.automationId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

/**
 * Fires sustained breaches whose window has elapsed.
 *
 * Without this a dwell window only completes when another sample happens to
 * arrive, so a breach that starts just before polling stops would never fire.
 */
async function recheckOpenBreaches(now: Date): Promise<void> {
  const repository = createCurrentAutomationRepository();
  const open = await repository.listOpenBreaches();
  const nowMs = now.getTime();

  for (const state of open) {
    const automation = await repository.findById(state.automationId);
    if (!automation || !automation.enabled) continue;
    if (!canAccess(automation.userId)) continue;

    let definition: AutomationDefinition;
    try {
      definition = JSON.parse(automation.definition) as AutomationDefinition;
    } catch {
      continue;
    }

    const trigger = definition.trigger;
    if (trigger?.kind !== "metric_threshold") continue;
    if (!trigger.forSeconds) continue;
    if (!hasDwelled(state.breachStartedAt, trigger.forSeconds, nowMs)) continue;
    if (isCoolingDown(state.lastFiredAt, trigger.cooldownMinutes, nowMs)) {
      continue;
    }

    const hostId = Number(state.stateKey.split(":")[0]);
    await repository.upsertTriggerState({
      automationId: automation.id,
      stateKey: state.stateKey,
      lastFiredAt: now.toISOString(),
    });

    AutomationEngine.getInstance()
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

  const repository = createCurrentAutomationRepository();
  try {
    await repository.failStaleRunningRuns(
      new Date(now.getTime() - STALE_RUN_MS).toISOString(),
    );
    const deleted = await repository.pruneRunsOlderThan(RUN_RETENTION_DAYS);
    if (deleted > 0) {
      statsLogger.info(`Pruned ${deleted} old automation run(s)`, {
        operation: "automation_run_prune",
        deleted,
      });
    }
  } catch (error) {
    statsLogger.warn("Automation run pruning failed", {
      operation: "automation_run_prune_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function canAccess(userId: string): boolean {
  try {
    return DataCrypto.canUserAccessData(userId);
  } catch {
    return false;
  }
}
