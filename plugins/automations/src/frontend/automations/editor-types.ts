import type { StepType, TriggerKind } from "../../types";
import type { AutomationProviders } from "../automations-api";

/** Lookup data the editor needs to turn ids into names. */
export interface AutomationEditorOptions {
  hosts: Array<{ id: number; name: string }>;
  snippets: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  fleets: Array<{ id: number; name: string }>;
  /** Which optional plugins are running. */
  providers: AutomationProviders;
}

export const EMPTY_EDITOR_OPTIONS: AutomationEditorOptions = {
  hosts: [],
  snippets: [],
  channels: [],
  fleets: [],
  providers: {
    snippets: false,
    fleets: false,
    tunnels: false,
    docker: false,
    "docker-events": false,
    "host-metrics": false,
    "wake-on-lan": false,
  },
};

/** Short unique id for a new step, stable for the life of the automation. */
export function newStepId(): string {
  return `s${Math.random().toString(36).slice(2, 8)}`;
}

/** The plugin a trigger kind needs, when it is not core. */
const TRIGGER_PROVIDERS: Partial<
  Record<TriggerKind, keyof AutomationProviders>
> = {
  metric_threshold: "host-metrics",
  health_check: "host-metrics",
  docker_event: "docker-events",
};

/** The plugin a step type needs, when it is not core. */
const STEP_PROVIDERS: Partial<Record<StepType, keyof AutomationProviders>> = {
  run_snippet: "snippets",
  docker: "docker",
  tunnel: "tunnels",
  wol: "wake-on-lan",
};

/** The plugin id shown in "needs <plugin>", for a provider key. */
export function providerPlugin(key: keyof AutomationProviders): string {
  return key === "docker-events" ? "docker" : key;
}

/** The provider a kind needs that is not running, or null when it can run. */
export function missingTriggerProvider(
  kind: TriggerKind,
  providers: AutomationProviders,
): string | null {
  const key = TRIGGER_PROVIDERS[kind];
  return key && !providers[key] ? providerPlugin(key) : null;
}

export function missingStepProvider(
  type: StepType,
  providers: AutomationProviders,
): string | null {
  const key = STEP_PROVIDERS[type];
  return key && !providers[key] ? providerPlugin(key) : null;
}
