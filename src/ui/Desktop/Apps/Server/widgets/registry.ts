import { Cpu, MemoryStick, HardDrive, type LucideIcon } from "lucide-react";
import type { WidgetType, WidgetSize } from "@/types/stats-widgets";

export interface WidgetSizeConfig {
  w: number;
  h: number;
}

export interface WidgetRegistryItem {
  type: WidgetType;
  label: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  sizes: Record<WidgetSize, WidgetSizeConfig>;
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
    sizes: {
      small: { w: 3, h: 2 }, // 紧凑：大号百分比+核心数
      medium: { w: 4, h: 2 }, // 标准：进度条+load average
      large: { w: 7, h: 3 }, // 图表：折线图需要宽度展示趋势
    },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  memory: {
    type: "memory",
    label: "Memory Usage",
    description: "Track RAM usage and availability",
    icon: MemoryStick,
    iconColor: "text-green-400",
    sizes: {
      small: { w: 3, h: 2 }, // 紧凑：百分比+用量
      medium: { w: 4, h: 2 }, // 标准：进度条+详细信息
      large: { w: 6, h: 3 }, // 图表：面积图展示
    },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  disk: {
    type: "disk",
    label: "Disk Usage",
    description: "View disk space consumption",
    icon: HardDrive,
    iconColor: "text-orange-400",
    sizes: {
      small: { w: 3, h: 2 }, // 紧凑：百分比+用量
      medium: { w: 4, h: 2 }, // 标准：进度条+可用空间
      large: { w: 4, h: 4 }, // 图表：径向图（方形，不需要太宽）
    },
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
 * Get widget size configuration
 */
export function getWidgetSize(
  type: WidgetType,
  size: WidgetSize,
): WidgetSizeConfig {
  return WIDGET_REGISTRY[type].sizes[size];
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
