export type Recurrence = "once" | "weekly" | "monthly";

export interface MaintenancePlan {
  id: string;
  reason: string;
  start: string;
  durationMinutes: number;
  recurrence: Recurrence;
  graceMinutes: number;
  notifyOverdue: boolean;
  nextStart: string | null;
}

export interface ActiveMaintenance {
  startedAt: string;
  reasons: string[];
  estimatedEnd: string;
  graceMinutes: number;
  notifyOverdue: boolean;
  notified: boolean;
}

export interface HostMaintenance {
  active: ActiveMaintenance | null;
  plans: MaintenancePlan[];
  /** Set on API responses: false when the host was shared with the caller. */
  owned?: boolean;
}

export const emptyMaintenance = (): HostMaintenance => ({
  active: null,
  plans: [],
});
