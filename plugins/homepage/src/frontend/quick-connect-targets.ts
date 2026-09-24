import type { ComponentType } from "react";
import type {
  HostActionContribution,
  PluginHostRecord,
} from "@termix/plugin-sdk/frontend";

export interface QuickConnectTarget {
  /** Tab type, and the value stored in a widget's config. */
  type: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  /** i18n key, or a literal label from a plugin action. */
  labelKey: string;
  enabled: (host: PluginHostRecord) => boolean;
}

/** What a quick connect widget can open: the tools plugins registered. */
export function quickConnectTargets(
  actions: HostActionContribution[],
): QuickConnectTarget[] {
  const seen = new Set<string>();
  const fromPlugins: QuickConnectTarget[] = [];
  for (const action of actions) {
    if (!action.tabType || seen.has(action.tabType)) continue;
    seen.add(action.tabType);
    fromPlugins.push({
      type: action.tabType,
      icon: action.icon,
      labelKey: action.titleKey,
      enabled: (h) => {
        try {
          return action.when(h);
        } catch {
          return false;
        }
      },
    });
  }
  return fromPlugins;
}
