import type { ComponentType } from "react";
import { Network } from "lucide-react";
import { tabTypeForActivity } from "@/shell/tab-registry";

export interface ActivityTarget {
  icon: ComponentType<{ className?: string }> | undefined;
  /** Tab type the entry reopens. */
  tab: string;
  labelKey: string | undefined;
}

/** Recent-activity types core itself records. */
const CORE_ACTIVITY: Record<string, ActivityTarget> = {
  tunnel: {
    icon: Network,
    tab: "tunnel",
    labelKey: "dashboard.activityTunnel",
  },
};

/**
 * What a recent-activity entry opens and how it is labelled. Plugin tabs
 * claim their activity types through the registry, so an entry whose plugin
 * is gone simply has no target.
 */
export function activityTarget(type: string): ActivityTarget | undefined {
  const core = CORE_ACTIVITY[type];
  if (core) return core;
  const def = tabTypeForActivity(type);
  if (!def) return undefined;
  return { icon: def.icon, tab: def.id, labelKey: def.titleKey };
}
