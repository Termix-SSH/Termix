import { Cpu, MemoryStick, HardDrive, type LucideIcon } from "lucide-react";
import type { WidgetType } from "@/types/stats-widgets";

export interface WidgetRegistryItem {
  type: WidgetType;
  label: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
}

export const WIDGET_REGISTRY: Record<WidgetType, WidgetRegistryItem> = {
  cpu: {
    type: "cpu",
    label: "CPU Usage",
    description: "Monitor CPU utilization and load average",
    icon: Cpu,
    iconColor: "text-blue-400",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  memory: {
    type: "memory",
    label: "Memory Usage",
    description: "Track RAM usage and availability",
    icon: MemoryStick,
    iconColor: "text-green-400",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  disk: {
    type: "disk",
    label: "Disk Usage",
    description: "View disk space consumption",
    icon: HardDrive,
    iconColor: "text-orange-400",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
};

/**
 * Get list of all available widgets
 */
export function getAvailableWidgets(): WidgetRegistryItem[] {
  return Object.values(WIDGET_REGISTRY);
}

/**
 * Get widget configuration by type
 */
export function getWidgetConfig(type: WidgetType): WidgetRegistryItem {
  return WIDGET_REGISTRY[type];
}

/**
 * Generate unique widget ID
 */
export function generateWidgetId(
  type: WidgetType,
  existingIds: string[],
): string {
  let counter = 1;
  let id = `${type}-${counter}`;
  while (existingIds.includes(id)) {
    counter++;
    id = `${type}-${counter}`;
  }
  return id;
}
