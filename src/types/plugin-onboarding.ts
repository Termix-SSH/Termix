/**
 * The onboarding plugin picker: what the admin chose for each plugin, and the
 * dependency rules that keep the result loadable. Shared by the picker (to
 * show "kept because X needs it" live) and the backend apply route.
 */

export type PluginChoice = "enabled" | "disabled" | "remove";

export const PLUGIN_CHOICES: readonly PluginChoice[] = [
  "enabled",
  "disabled",
  "remove",
];

export interface ChoicePlugin {
  id: string;
  /** Hard dependencies (plugin ids). */
  dependencies: string[];
}

export interface ChoiceAdjustment {
  id: string;
  from: PluginChoice;
  to: PluginChoice;
  /** The plugins whose choice forced this one up. */
  requiredBy: string[];
}

const RANK: Record<PluginChoice, number> = {
  remove: 0,
  disabled: 1,
  enabled: 2,
};

export function isPluginChoice(value: unknown): value is PluginChoice {
  return PLUGIN_CHOICES.includes(value as PluginChoice);
}

/**
 * Raise choices until every plugin's dependencies can serve it: an enabled
 * plugin needs its dependencies enabled, and a kept but disabled plugin
 * needs them at least kept. Ids missing from `choices` stay as they are and
 * are never adjusted.
 */
export function resolvePluginChoices(
  plugins: ChoicePlugin[],
  choices: Record<string, PluginChoice>,
): {
  choices: Record<string, PluginChoice>;
  adjustments: ChoiceAdjustment[];
} {
  const resolved: Record<string, PluginChoice> = { ...choices };
  const requiredBy = new Map<string, Set<string>>();
  const known = new Set(plugins.map((p) => p.id));

  let changed = true;
  while (changed) {
    changed = false;
    for (const plugin of plugins) {
      const own = resolved[plugin.id];
      if (!own || own === "remove") continue;
      for (const dep of plugin.dependencies) {
        if (!known.has(dep) || !resolved[dep]) continue;
        if (RANK[resolved[dep]] >= RANK[own]) continue;
        resolved[dep] = own;
        if (!requiredBy.has(dep)) requiredBy.set(dep, new Set());
        requiredBy.get(dep)!.add(plugin.id);
        changed = true;
      }
    }
  }

  const adjustments: ChoiceAdjustment[] = [];
  for (const [id, from] of Object.entries(choices)) {
    const to = resolved[id];
    if (to !== from) {
      adjustments.push({
        id,
        from,
        to,
        requiredBy: [...(requiredBy.get(id) ?? [])].sort(),
      });
    }
  }
  return { choices: resolved, adjustments };
}

/** Dependencies before the plugins that need them. */
function topoOrder(plugins: ChoicePlugin[], ids: Set<string>): string[] {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const out: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (ids.has(dep)) visit(dep);
    }
    visiting.delete(id);
    done.add(id);
    out.push(id);
  };
  for (const id of [...ids].sort()) visit(id);
  return out;
}

/**
 * The order to apply resolved choices in: enable dependencies first, and
 * disable or remove dependents first.
 */
export function applyOrder(
  plugins: ChoicePlugin[],
  resolved: Record<string, PluginChoice>,
): { enable: string[]; disable: string[]; remove: string[] } {
  const pick = (choice: PluginChoice) =>
    new Set(
      Object.entries(resolved)
        .filter(([, c]) => c === choice)
        .map(([id]) => id),
    );
  return {
    enable: topoOrder(plugins, pick("enabled")),
    disable: topoOrder(plugins, pick("disabled")).reverse(),
    remove: topoOrder(plugins, pick("remove")).reverse(),
  };
}
