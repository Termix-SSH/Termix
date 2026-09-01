import type {
  AutomationDefinition,
  HostSelector,
  Trigger,
} from "../../types/automations.js";
import { createCurrentAutomationRepository } from "../database/repositories/factory.js";
import type { AutomationEngineRow } from "../database/repositories/automation-repository.js";
import { statsLogger } from "../utils/logger.js";
import {
  compare,
  extractMetricValue,
  hasDwelled,
  isCoolingDown,
  metricStateKey,
  severityForValue,
  type MetricsSnapshot,
} from "./conditions.js";
import { AutomationEngine } from "./engine.js";

/**
 * Matches events against automation triggers and decides what fires.
 *
 * Dwell windows and cooldowns live in automation_trigger_state rather than in
 * memory, so a restart mid-breach neither loses the window nor re-fires an
 * alert that already went out.
 */

export interface MetricEvent {
  hostId: number;
  ownerUserId: string;
  metrics: MetricsSnapshot;
}

export interface StatusEvent {
  hostId: number;
  ownerUserId: string;
  online: boolean;
}

export interface HealthEvent {
  hostId: number;
  userId: string;
  checkId: string;
  ok: boolean;
  detail?: string;
}

export interface DockerEvent {
  hostId: number;
  ownerUserId: string;
  container: string;
  event: "exited" | "started" | "unhealthy" | "restarting";
}

export interface InternalEvent {
  event: string;
  userId: string;
  hostId?: number;
  details?: Record<string, unknown>;
}

interface LoadedAutomation {
  row: AutomationEngineRow;
  definition: AutomationDefinition;
}

async function loadEnabledFor(userId: string): Promise<LoadedAutomation[]> {
  try {
    const rows =
      await createCurrentAutomationRepository().listEnabledForUser(userId);
    const loaded: LoadedAutomation[] = [];
    for (const row of rows) {
      try {
        loaded.push({
          row,
          definition: JSON.parse(row.definition) as AutomationDefinition,
        });
      } catch {
        // A malformed definition should not stop the others from evaluating.
      }
    }
    return loaded;
  } catch {
    return [];
  }
}

/** Whether a selector covers a host. Ownership is checked by the caller. */
function selectorCoversHost(
  selector: HostSelector | undefined,
  hostId: number,
): boolean {
  if (!selector) return true;
  switch (selector.kind) {
    case "all":
    case "trigger":
      return true;
    case "host":
      return selector.hostId === hostId;
    case "hosts":
      return selector.hostIds.includes(hostId);
    case "fleet":
      // Fleet membership is resolved at execution time; evaluate optimistically
      // so a fleet-scoped trigger still reaches the engine.
      return true;
    default:
      return false;
  }
}

async function fire(
  automation: AutomationEngineRow,
  stateKey: string,
  triggerType: string,
  triggerContext: Record<string, unknown>,
  hostId?: number,
): Promise<void> {
  const repository = createCurrentAutomationRepository();
  await repository.upsertTriggerState({
    automationId: automation.id,
    stateKey,
    lastFiredAt: new Date().toISOString(),
  });

  AutomationEngine.getInstance()
    .run({
      automationId: automation.id,
      triggerType,
      triggerContext,
      triggerHostId: hostId,
    })
    .catch((error) => {
      statsLogger.warn("Automation run failed to start", {
        operation: "automation_trigger_error",
        automationId: automation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Metric samples. Called for every polled host, including hosts polled only
 * because an automation asked for them.
 */
export async function onMetrics(event: MetricEvent): Promise<void> {
  const automations = await loadEnabledFor(event.ownerUserId);
  const repository = createCurrentAutomationRepository();
  const now = Date.now();

  for (const { row, definition } of automations) {
    const trigger = definition.trigger;
    if (trigger?.kind !== "metric_threshold") continue;
    if (!selectorCoversHost(trigger.hostSelector, event.hostId)) continue;

    const value = extractMetricValue(event.metrics, trigger.metric);
    if (value === null) continue;

    const stateKey = metricStateKey(event.hostId, trigger.metric);
    const state = await repository.getTriggerState(row.id, stateKey);
    const breaching = compare(value, trigger.operator, trigger.value);

    if (!breaching) {
      if (state?.breachStartedAt) {
        await repository.clearBreach(row.id, stateKey);
      }
      continue;
    }

    // Open the dwell window on the first breaching sample.
    if (!state?.breachStartedAt) {
      await repository.upsertTriggerState({
        automationId: row.id,
        stateKey,
        breachStartedAt: new Date(now).toISOString(),
        lastValue: value,
      });
      if (trigger.forSeconds) continue;
    }

    const breachStartedAt =
      state?.breachStartedAt ?? new Date(now).toISOString();
    if (!hasDwelled(breachStartedAt, trigger.forSeconds, now)) continue;
    if (isCoolingDown(state?.lastFiredAt, trigger.cooldownMinutes, now))
      continue;

    await fire(
      row,
      stateKey,
      "metric_threshold",
      {
        hostId: event.hostId,
        value,
        threshold: trigger.value,
        operator: trigger.operator,
        metric: trigger.metric.path,
        mount: "mount" in trigger.metric ? trigger.metric.mount : undefined,
        severity: severityForValue(value, trigger.severity),
      },
      event.hostId,
    );
  }
}

/** Host reachability transitions. Only edges fire, never steady state. */
export async function onStatus(event: StatusEvent): Promise<void> {
  const automations = await loadEnabledFor(event.ownerUserId);
  const repository = createCurrentAutomationRepository();
  const now = Date.now();
  const observed = event.online ? "online" : "offline";

  for (const { row, definition } of automations) {
    const trigger = definition.trigger;
    if (trigger?.kind !== "host_status") continue;
    if (!selectorCoversHost(trigger.hostSelector, event.hostId)) continue;

    const stateKey = String(event.hostId);
    const state = await repository.getTriggerState(row.id, stateKey);

    if (state?.lastObservedState === observed) continue;

    await repository.upsertTriggerState({
      automationId: row.id,
      stateKey,
      lastObservedState: observed,
    });

    // The first observation establishes a baseline rather than firing, so a
    // restart does not announce every host as though it just changed.
    if (!state?.lastObservedState) continue;
    if (trigger.to !== observed) continue;
    if (isCoolingDown(state?.lastFiredAt, trigger.cooldownMinutes, now))
      continue;

    await fire(
      row,
      stateKey,
      "host_status",
      { hostId: event.hostId, status: observed },
      event.hostId,
    );
  }
}

export async function onHealthCheck(event: HealthEvent): Promise<void> {
  const automations = await loadEnabledFor(event.userId);
  const repository = createCurrentAutomationRepository();
  const now = Date.now();
  const observed = event.ok ? "recovered" : "failing";

  for (const { row, definition } of automations) {
    const trigger = definition.trigger;
    if (trigger?.kind !== "health_check") continue;
    if (!selectorCoversHost(trigger.hostSelector, event.hostId)) continue;
    if (trigger.checkId && trigger.checkId !== event.checkId) continue;

    const stateKey = `${event.hostId}:${event.checkId}`;
    const state = await repository.getTriggerState(row.id, stateKey);

    if (state?.lastObservedState === observed) continue;

    await repository.upsertTriggerState({
      automationId: row.id,
      stateKey,
      lastObservedState: observed,
    });

    if (!state?.lastObservedState) continue;
    if (trigger.to !== observed) continue;
    if (isCoolingDown(state?.lastFiredAt, trigger.cooldownMinutes, now))
      continue;

    await fire(
      row,
      stateKey,
      "health_check",
      {
        hostId: event.hostId,
        checkId: event.checkId,
        state: observed,
        detail: event.detail,
      },
      event.hostId,
    );
  }
}

export async function onDockerEvent(event: DockerEvent): Promise<void> {
  const automations = await loadEnabledFor(event.ownerUserId);
  const repository = createCurrentAutomationRepository();
  const now = Date.now();

  for (const { row, definition } of automations) {
    const trigger = definition.trigger;
    if (trigger?.kind !== "docker_event") continue;
    if (!selectorCoversHost(trigger.hostSelector, event.hostId)) continue;
    if (trigger.container && trigger.container !== event.container) continue;
    if (trigger.event !== event.event) continue;

    const stateKey = `${event.hostId}:${event.container}`;
    const state = await repository.getTriggerState(row.id, stateKey);
    if (isCoolingDown(state?.lastFiredAt, trigger.cooldownMinutes, now))
      continue;

    await fire(
      row,
      stateKey,
      "docker_event",
      {
        hostId: event.hostId,
        container: event.container,
        event: event.event,
      },
      event.hostId,
    );
  }
}

export async function onInternalEvent(event: InternalEvent): Promise<void> {
  const automations = await loadEnabledFor(event.userId);
  const repository = createCurrentAutomationRepository();
  const now = Date.now();

  for (const { row, definition } of automations) {
    const trigger = definition.trigger;
    if (trigger?.kind !== "internal_event") continue;
    if (trigger.event !== event.event) continue;
    if (
      event.hostId !== undefined &&
      !selectorCoversHost(trigger.hostSelector, event.hostId)
    ) {
      continue;
    }

    const stateKey = event.hostId ? String(event.hostId) : "global";
    const state = await repository.getTriggerState(row.id, stateKey);
    if (isCoolingDown(state?.lastFiredAt, trigger.cooldownMinutes, now))
      continue;

    await fire(
      row,
      stateKey,
      "internal_event",
      { event: event.event, hostId: event.hostId, ...(event.details ?? {}) },
      event.hostId,
    );
  }
}

/**
 * Hosts that an enabled automation watches, so the poller knows to collect
 * metrics for them even when nobody is looking.
 */
export async function listAutomationWatchedHosts(): Promise<
  Map<number, string>
> {
  const watched = new Map<number, string>();

  try {
    const rows = await createCurrentAutomationRepository().listAllEnabled();
    for (const row of rows) {
      let definition: AutomationDefinition;
      try {
        definition = JSON.parse(row.definition) as AutomationDefinition;
      } catch {
        continue;
      }

      const trigger: Trigger | undefined = definition.trigger;
      // Only metric thresholds need heavy collection; status triggers are
      // already served by the cheap reachability probe.
      if (trigger?.kind !== "metric_threshold") continue;

      const selector = trigger.hostSelector;
      if (selector?.kind === "host") {
        watched.set(selector.hostId, row.userId);
      } else if (selector?.kind === "hosts") {
        for (const hostId of selector.hostIds) watched.set(hostId, row.userId);
      }
      // Fleet and "all" selectors are resolved by the scheduler, which can
      // expand them without blocking this call.
    }
  } catch {
    return watched;
  }

  return watched;
}
