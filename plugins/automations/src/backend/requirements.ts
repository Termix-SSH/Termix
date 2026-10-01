import type { AutomationDefinition, HostSelector, Step } from "../types.js";
import { pluginOf, type Deps, type ProviderKey } from "./deps.js";

/**
 * The providers a definition cannot run without. A trigger or step whose
 * plugin is off makes the whole automation wait for it, rather than half of
 * it running.
 */
export function requiredProviders(
  definition: AutomationDefinition | null | undefined,
): ProviderKey[] {
  const needed = new Set<ProviderKey>();
  if (!definition) return [];

  const selector = (value: HostSelector | undefined) => {
    if (value?.kind === "fleet") needed.add("fleets");
  };

  const trigger = definition.trigger;
  switch (trigger?.kind) {
    case "metric_threshold":
    case "health_check":
      needed.add("host-metrics");
      selector(trigger.hostSelector);
      break;
    case "docker_event":
      needed.add("docker-events");
      selector(trigger.hostSelector);
      break;
    case "host_status":
      selector(trigger.hostSelector);
      break;
    case "internal_event":
      if (trigger.event === "tunnel_disconnected") needed.add("tunnels");
      selector(trigger.hostSelector);
      break;
    default:
      break;
  }

  const walk = (steps: Step[] | undefined) => {
    for (const step of steps ?? []) {
      if (step.enabled === false) continue;
      switch (step.type) {
        case "run_snippet":
          needed.add("snippets");
          selector(step.hostSelector);
          break;
        case "run_command":
          selector(step.hostSelector);
          break;
        case "docker":
          needed.add("docker");
          selector(step.hostSelector);
          break;
        case "tunnel":
          needed.add("tunnels");
          break;
        case "wol":
          needed.add("wake-on-lan");
          break;
        case "if":
          walk(step.then);
          walk(step.else);
          break;
        default:
          break;
      }
    }
  };
  walk(definition.steps);

  return [...needed];
}

/** Plugin ids the definition needs that are not running, deduplicated. */
export function missingPlugins(
  definition: AutomationDefinition | null | undefined,
  deps: Pick<Deps, "available">,
): string[] {
  const missing = requiredProviders(definition)
    .filter((key) => !deps.available(key))
    .map(pluginOf);
  return [...new Set(missing)];
}

export function parseDefinition(raw: string): AutomationDefinition | null {
  try {
    return JSON.parse(raw) as AutomationDefinition;
  } catch {
    return null;
  }
}
