import type { ComponentType } from "react";
import type { SSHHostWithStatus } from "@/main-axios";
import type { Host } from "@/types/ui-types";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import type { HostActionDef } from "@/sidebar/host-contributions";
import { listTabTypes } from "@/shell/tab-registry";

export interface QuickConnectTarget {
  /** Tab type, and the value stored in a widget's config. */
  type: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  /** i18n key, or a literal label from a plugin action. */
  labelKey: string;
  enabled: (host: SSHHostWithStatus) => boolean;
}

/** What a quick connect widget can open: the tools plugins registered. */
export function quickConnectTargets(
  actions: HostActionDef[],
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
          return action.when(sshHostToHost(h) as Host);
        } catch {
          return false;
        }
      },
    });
  }
  return fromPlugins;
}

/** Recent-activity types a filter can pick: core ones plus plugin tabs'. */
export function activityFilterTypes(): string[] {
  const types = new Set(["file_manager"]);
  for (const def of listTabTypes()) {
    for (const type of def.activityTypes ?? []) types.add(type);
  }
  return [...types];
}
