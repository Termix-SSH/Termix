import { rbacApi } from "@/main-axios";

export interface NotificationChannel {
  id: number;
  userId: string;
  name: string;
  type: "webhook" | "ntfy";
  config: string;
  enabled: boolean;
  createdAt: string;
}

export interface AlertRule {
  id: number;
  userId: string;
  hostId: number | null;
  name: string;
  enabled: boolean;
  triggerType: string;
  thresholdValue: number | null;
  thresholdDurationSeconds: number | null;
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
  channelIds: number[];
}

export interface AlertFiring {
  id: number;
  userId: string;
  ruleId: number;
  hostId: number;
  hostName: string;
  firedAt: string;
  resolvedAt: string | null;
  value: number | null;
  message: string;
  severity: "info" | "warning" | "critical";
  acknowledged: boolean;
  ruleName?: string;
}

export async function getNotificationChannels(): Promise<
  NotificationChannel[]
> {
  const res = await rbacApi.get("/notification-channels");
  return res.data;
}

export async function createNotificationChannel(
  data: Partial<NotificationChannel>,
): Promise<NotificationChannel> {
  const res = await rbacApi.post("/notification-channels", data);
  return res.data;
}

export async function updateNotificationChannel(
  id: number,
  data: Partial<NotificationChannel>,
): Promise<NotificationChannel> {
  const res = await rbacApi.put(`/notification-channels/${id}`, data);
  return res.data;
}

export async function deleteNotificationChannel(id: number): Promise<void> {
  await rbacApi.delete(`/notification-channels/${id}`);
}

export async function testNotificationChannel(id: number): Promise<void> {
  await rbacApi.post(`/notification-channels/${id}/test`);
}

function mapRule(r: Record<string, unknown>): AlertRule {
  return {
    id: r.id as number,
    userId: (r.user_id ?? r.userId) as string,
    hostId: (r.host_id ?? r.hostId ?? null) as number | null,
    name: r.name as string,
    enabled: Boolean(r.enabled),
    triggerType: (r.trigger_type ?? r.triggerType) as string,
    thresholdValue: (r.threshold_value ?? r.thresholdValue ?? null) as
      | number
      | null,
    thresholdDurationSeconds: (r.threshold_duration_seconds ??
      r.thresholdDurationSeconds ??
      null) as number | null,
    cooldownMinutes: (r.cooldown_minutes ?? r.cooldownMinutes) as number,
    createdAt: (r.created_at ?? r.createdAt) as string,
    updatedAt: (r.updated_at ?? r.updatedAt) as string,
    channelIds: Array.isArray(r.channels) ? (r.channels as number[]) : [],
  };
}

export async function getAlertRules(): Promise<AlertRule[]> {
  const res = await rbacApi.get("/alert-rules");
  return (res.data as Record<string, unknown>[]).map(mapRule);
}

export async function createAlertRule(
  data: Partial<AlertRule> & { channels?: number[] },
): Promise<AlertRule> {
  const res = await rbacApi.post("/alert-rules", data);
  return mapRule(res.data as Record<string, unknown>);
}

export async function updateAlertRule(
  id: number,
  data: Partial<AlertRule> & { channels?: number[] },
): Promise<AlertRule> {
  const res = await rbacApi.put(`/alert-rules/${id}`, data);
  return mapRule(res.data as Record<string, unknown>);
}

export async function deleteAlertRule(id: number): Promise<void> {
  await rbacApi.delete(`/alert-rules/${id}`);
}

export async function getAlertFirings(opts?: {
  limit?: number;
  offset?: number;
  acknowledged?: boolean;
}): Promise<AlertFiring[]> {
  const res = await rbacApi.get("/alert-firings", { params: opts });
  return (res.data as { firings: AlertFiring[] }).firings ?? res.data;
}

export async function acknowledgeAlertFiring(id: number): Promise<void> {
  await rbacApi.post(`/alert-firings/${id}/acknowledge`);
}

export async function acknowledgeAllAlertFirings(): Promise<void> {
  await rbacApi.post("/alert-firings/acknowledge-all");
}
