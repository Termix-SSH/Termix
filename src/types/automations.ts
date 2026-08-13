/**
 * Shared automation model used by both the backend engine and the editor UI.
 * An automation is one trigger plus an ordered list of steps. The whole
 * definition is stored as JSON on the automations row, so this file is the
 * only contract describing that blob.
 */

export const AUTOMATION_DEFINITION_VERSION = 1;

/** Which hosts a trigger watches or a step acts on. */
export type HostSelector =
  | { kind: "host"; hostId: number }
  | { kind: "hosts"; hostIds: number[] }
  | { kind: "fleet"; fleetId: number }
  | { kind: "all" }
  /** The host that produced the event. Only valid for host-scoped triggers. */
  | { kind: "trigger" };

/**
 * A metric to compare against. Paths mirror the shape returned by
 * collectMetrics(). mount/iface pick one entry out of a per-instance list so a
 * rule can watch a single filesystem rather than the aggregate.
 */
export type MetricPath =
  | { path: "cpu.percent" }
  | { path: "cpu.load1" }
  | { path: "cpu.load5" }
  | { path: "cpu.load15" }
  | { path: "memory.percent" }
  | { path: "memory.usedGiB" }
  | { path: "disk.percent"; mount?: string }
  | { path: "disk.availableBytes"; mount?: string }
  | { path: "temperature.highestCelsius" }
  | { path: "uptime.seconds" }
  | { path: "processes.total" }
  | { path: "network.rxBytes"; iface?: string }
  | { path: "network.txBytes"; iface?: string };

export type Operator =
  | ">"
  | "<"
  | ">="
  | "<="
  | "=="
  | "!="
  | "contains"
  | "not_contains"
  | "changed";

export type Severity = "info" | "warning" | "critical";

export type HostStatusState = "online" | "offline";
export type HealthCheckState = "failing" | "recovered";
export type DockerEventKind = "exited" | "started" | "unhealthy" | "restarting";

export type InternalEventKind =
  | "user_login"
  | "host_added"
  | "host_deleted"
  | "tunnel_disconnected"
  | "automation_failed";

export type Trigger =
  | {
      kind: "metric_threshold";
      hostSelector: HostSelector;
      metric: MetricPath;
      operator: Operator;
      value: number;
      /** Sustained breach window before firing. 0 fires immediately. */
      forSeconds?: number;
      cooldownMinutes: number;
      severity?: Severity;
    }
  | {
      kind: "host_status";
      hostSelector: HostSelector;
      to: HostStatusState;
      cooldownMinutes: number;
    }
  | {
      kind: "health_check";
      hostSelector: HostSelector;
      checkId?: string;
      to: HealthCheckState;
      cooldownMinutes: number;
    }
  | {
      kind: "schedule";
      /** Five field cron. Ignored when intervalSeconds is set. */
      cron?: string;
      intervalSeconds?: number;
      timezone?: string;
    }
  | {
      kind: "docker_event";
      hostSelector: HostSelector;
      container?: string;
      event: DockerEventKind;
      cooldownMinutes: number;
    }
  | {
      kind: "internal_event";
      event: InternalEventKind;
      hostSelector?: HostSelector;
      cooldownMinutes: number;
    }
  | {
      kind: "webhook";
      /** Only the hash is persisted. The raw token is shown once on creation. */
      tokenHash: string;
    };

export type TriggerKind = Trigger["kind"];

/** A comparison used by `if` steps, evaluated against the run context. */
export interface Condition {
  /** Template string, e.g. "{{steps.check.stdout}}" or "{{trigger.value}}". */
  left: string;
  operator: Operator;
  /** Template string. Compared numerically when both sides parse as numbers. */
  right?: string;
}

export type StepErrorPolicy = "stop" | "continue" | "branch";

interface StepBase {
  /** Stable across edits so run history survives reordering. */
  id: string;
  name?: string;
  enabled?: boolean;
  onError?: StepErrorPolicy;
  timeoutMs?: number;
}

export type Step =
  | (StepBase & {
      type: "notify";
      channelIds: number[];
      title?: string;
      body?: string;
      severity?: Severity;
    })
  | (StepBase & {
      type: "http";
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      url: string;
      headers?: Record<string, string>;
      body?: string;
      /** Opt in to LAN/private addresses. Off by default, see safe-outbound-fetch. */
      allowPrivateNetwork?: boolean;
    })
  | (StepBase & {
      type: "run_snippet";
      snippetId: number;
      hostSelector: HostSelector;
      inputValues?: Record<string, string>;
      elevated?: boolean;
    })
  | (StepBase & {
      type: "run_command";
      command: string;
      hostSelector: HostSelector;
      elevated?: boolean;
    })
  | (StepBase & {
      type: "docker";
      action: "start" | "stop" | "restart";
      container: string;
      hostSelector: HostSelector;
    })
  | (StepBase & {
      type: "tunnel";
      action: "connect" | "disconnect";
      tunnelName: string;
    })
  | (StepBase & { type: "wol"; hostId: number })
  | (StepBase & { type: "wait"; seconds: number })
  | (StepBase & { type: "set_var"; name: string; value: string })
  | (StepBase & {
      type: "if";
      condition: Condition;
      then: Step[];
      else?: Step[];
    })
  | (StepBase & { type: "run_automation"; automationId: number })
  | (StepBase & { type: "stop"; status?: "success" | "failed" });

export type StepType = Step["type"];

export interface AutomationDefinition {
  version: number;
  trigger: Trigger;
  steps: Step[];
}

export type ConcurrencyPolicy = "skip" | "queue" | "allow";

export type RunStatus =
  "running" | "success" | "failed" | "timeout" | "skipped" | "cancelled";

export type StepStatus =
  "pending" | "running" | "success" | "failed" | "skipped";

export interface Automation {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  definition: AutomationDefinition;
  concurrencyPolicy: ConcurrencyPolicy;
  maxRunSeconds: number;
  dryRun: boolean;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: number;
  automationId: number;
  userId: string;
  triggerType: TriggerKind | "manual";
  triggerContext: Record<string, unknown> | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  dryRun: boolean;
  parentRunId: number | null;
}

export interface AutomationRunStep {
  id: number;
  runId: number;
  stepIndex: number;
  stepId: string;
  stepType: StepType;
  status: StepStatus;
  startedAt: string;
  finishedAt: string | null;
  output: string | null;
  error: string | null;
  truncated: boolean;
}

/** Defaults applied when an automation does not override them. */
export const DEFAULT_MAX_RUN_SECONDS = 300;
export const DEFAULT_STEP_TIMEOUT_MS = 60_000;
export const DEFAULT_COOLDOWN_MINUTES = 15;
/** Guards run_automation against direct and mutual recursion. */
export const MAX_AUTOMATION_DEPTH = 5;
/** Step output beyond this is truncated before it reaches the database. */
export const MAX_STEP_OUTPUT_BYTES = 32_768;

export const OPERATOR_LABELS: Record<Operator, string> = {
  ">": "greater than",
  "<": "less than",
  ">=": "greater than or equal to",
  "<=": "less than or equal to",
  "==": "equals",
  "!=": "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  changed: "changed",
};

/** Steps that reach outside Termix and are therefore stubbed in a dry run. */
export const SIDE_EFFECTING_STEP_TYPES: readonly StepType[] = [
  "notify",
  "http",
  "run_snippet",
  "run_command",
  "docker",
  "tunnel",
  "wol",
];

export function isSideEffectingStep(type: StepType): boolean {
  return SIDE_EFFECTING_STEP_TYPES.includes(type);
}
