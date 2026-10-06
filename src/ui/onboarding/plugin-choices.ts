import type {
  OnboardingPluginInfo,
  OnboardingPluginList,
  PluginChoice,
} from "@/api/plugins-api";

export function currentChoice(plugin: OnboardingPluginInfo): PluginChoice {
  return plugin.state === "enabled" ? "enabled" : "disabled";
}

/**
 * What the picker starts on. On a fresh install recommended plugins are on
 * and the rest are set to be removed; consent ones start on. Later runs
 * start from how things are now.
 */
export function defaultChoices(
  list: OnboardingPluginList,
): Record<string, PluginChoice> {
  return Object.fromEntries(
    list.plugins.map((plugin) => {
      if (
        !list.pending ||
        list.reason !== "fresh" ||
        plugin.source !== "bundled"
      ) {
        return [plugin.id, currentChoice(plugin)];
      }
      if (plugin.consent) return [plugin.id, "enabled"];
      return [plugin.id, plugin.recommended ? "enabled" : "remove"];
    }),
  );
}

export function recommendedChoices(
  list: OnboardingPluginList,
): Record<string, PluginChoice> {
  return Object.fromEntries(
    list.plugins.map((plugin) => [
      plugin.id,
      plugin.recommended || plugin.consent ? "enabled" : "remove",
    ]),
  );
}
