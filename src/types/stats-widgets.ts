export type WidgetType =
  | "cpu" // CPU 使用率
  | "memory" // 内存使用率
  | "disk"; // 磁盘使用率
// 预留未来功能
// | 'network'   // 网络统计
// | 'processes' // 进程数
// | 'uptime';   // 运行时间

export type WidgetSize = "small" | "medium" | "large";

export interface Widget {
  id: string; // 唯一 ID："cpu-1", "memory-2"
  type: WidgetType; // 卡片类型
  size: WidgetSize; // 尺寸：small/medium/large
  x: number; // 网格X坐标 (0-11)
  y: number; // 网格Y坐标
  w: number; // 宽度（网格单位 1-12）
  h: number; // 高度（网格单位）
}

export interface StatsConfig {
  widgets: Widget[];
}

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  widgets: [
    { id: "cpu-1", type: "cpu", size: "medium", x: 0, y: 0, w: 4, h: 2 },
    { id: "memory-1", type: "memory", size: "medium", x: 4, y: 0, w: 4, h: 2 },
    { id: "disk-1", type: "disk", size: "medium", x: 8, y: 0, w: 4, h: 2 },
  ],
};

export const WIDGET_TYPE_CONFIG = {
  cpu: {
    label: "CPU Usage",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  memory: {
    label: "Memory Usage",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  disk: {
    label: "Disk Usage",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
} as const;
