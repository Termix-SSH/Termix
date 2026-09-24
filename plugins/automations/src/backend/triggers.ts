import type { PluginEvents, PluginLogger } from "@termix/plugin-sdk/backend";
import type { AutomationDefinition, HostSelector, Trigger } from "../types.js";
import type {
  AutomationEngineRow,
  AutomationRepository,
} from "./repository.js";
import {
  compare,
  extractMetricValue,
  hasDwelled,
  isCoolingDown,
  metricStateKey,
  severityForValue,
  type MetricsSnapshot,
} from "./conditions.js";
import { TOPIC_AUTOMATION_FAILED, type AutomationEngine } from "./engine.js";

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

export type Triggers = ReturnType<typeof createTriggers>;

/** Built once per activation. */
export function createTriggers(
  repository: AutomationRepository,
  engine: Pick<AutomationEngine, "run">,
  log: PluginLogger,
) {
  async function loadEnabledFor(userId: string): Promise<LoadedAutomation[]> {
    try {
      const rows = await repository.listEnabledForUser(userId);
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
    await repository.upsertTriggerState({
      automationId: automation.id,
      stateKey,
      lastFiredAt: new Date().toISOString(),
    });

    engine
      .run({
        automationId: automation.id,
        triggerType,
        triggerContext,
        triggerHostId: hostId,
      })
      .catch((error: unknown) => {
        log.warn(
          `Automation ${automation.id} failed to start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * Metric samples. Called for every polled host, including hosts polled only
   * because an automation asked for them.
   */
  async function onMetrics(event: MetricEvent): Promise<void> {
    const automations = await loadEnabledFor(event.ownerUserId);
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
  async function onStatus(event: StatusEvent): Promise<void> {
    const automations = await loadEnabledFor(event.ownerUserId);
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

  async function onHealthCheck(event: HealthEvent): Promise<void> {
    const automations = await loadEnabledFor(event.userId);
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

  async function onDockerEvent(event: DockerEvent): Promise<void> {
    const automations = await loadEnabledFor(event.ownerUserId);
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

  async function onInternalEvent(event: InternalEvent): Promise<void> {
    const automations = await loadEnabledFor(event.userId);
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
   * Hosts an enabled automation watches with the given trigger kind, with
   * the owning user. Fleet and "all" selectors are not expanded: collecting
   * for every host a user owns is far too costly.
   */
  async function watchedHosts(
    kind: "metric_threshold" | "docker_event",
  ): Promise<Map<number, string>> {
    const watched = new Map<number, string>();
    try {
      for (const row of await repository.listAllEnabled()) {
        let definition: AutomationDefinition;
        try {
          definition = JSON.parse(row.definition) as AutomationDefinition;
        } catch {
          continue;
        }
        const trigger: Trigger | undefined = definition.trigger;
        if (trigger?.kind !== kind) continue;
        const selector = trigger.hostSelector;
        if (selector?.kind === "host") {
          watched.set(selector.hostId, row.userId);
        } else if (selector?.kind === "hosts") {
          for (const hostId of selector.hostIds)
            watched.set(hostId, row.userId);
        }
      }
    } catch {
      return watched;
    }
    return watched;
  }

  /**
   * Subscribes to the topics the triggers read. Every listener is disposed
   * with the plugin. Handlers are async and the bus is fire-and-forget, so a
   * rejection is logged here rather than reaching whoever emitted.
   */
  function subscribe(events: PluginEvents): void {
    const on = <T>(
      topic: string,
      handler: (payload: T) => Promise<void> | undefined,
    ) =>
      events.on(topic, (payload) => {
        void Promise.resolve(handler(payload as T)).catch((error: unknown) =>
          log.warn(
            `Automation trigger for ${topic} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      });

    on<MetricEvent>("plugin.host-metrics.snapshot", onMetrics);
    on<HealthEvent>("plugin.host-metrics.health-check", onHealthCheck);
    on<StatusEvent>("host.status", onStatus);
    on<InternalEvent>("internal.event", (event) =>
      event?.userId ? onInternalEvent(event) : undefined,
    );
    // An SSH login seen by the terminal.
    on<{ hostId: number; userId: string; sshUser?: string; fromIp?: string }>(
      "host.login",
      (login) =>
        login?.userId
          ? onInternalEvent({
              event: "user_login",
              userId: login.userId,
              hostId: login.hostId,
              details: { sshUser: login.sshUser, fromIp: login.fromIp },
            })
          : undefined,
    );
    // Nothing arrives here while the tunnels plugin is off, which is the
    // whole of that optional dependency.
    on<{ userId?: string; hostId?: number; tunnelName?: string }>(
      "plugin.tunnels.tunnel_disconnected",
      (event) =>
        event?.userId
          ? onInternalEvent({
              event: "tunnel_disconnected",
              userId: event.userId,
              hostId: event.hostId,
              details: { tunnelName: event.tunnelName },
            })
          : undefined,
    );
    on<{
      userId?: string;
      automationId?: number;
      automationName?: string;
      runId?: number;
      error?: string | null;
    }>(TOPIC_AUTOMATION_FAILED, (event) =>
      event?.userId
        ? onInternalEvent({
            event: "automation_failed",
            userId: event.userId,
            details: {
              automationId: event.automationId,
              automationName: event.automationName,
              runId: event.runId,
              error: event.error ?? null,
            },
          })
        : undefined,
    );
  }

  return {
    onMetrics,
    onStatus,
    onHealthCheck,
    onDockerEvent,
    onInternalEvent,
    watchedHosts,
    subscribe,
  };
}
