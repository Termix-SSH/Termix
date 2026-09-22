import { rbacApi } from "@/main-axios";

export interface NotificationChannel {
  id: number;
  userId: string;
  name: string;
  type: "webhook" | "ntfy" | "discord";
  config: string;
  enabled: boolean;
  createdAt: string;
}

export async function getNotificationChannels(): Promise<
  NotificationChannel[]
> {
  const res = await rbacApi.get("/notification-channels");
  return res.data;
}

export type NotificationChannelPayload = Partial<
  Omit<NotificationChannel, "config">
> & {
  // When creating/updating the channel the UI may pass a parsed object
  // for `config` (e.g., { url, username }) — the backend stores it as
  // a JSON string. Accept either a string or any structured object here.
  // Use `unknown` to allow the component-local config types to be passed
  // without importing them into this module.
  config: string | unknown;
};

export async function createNotificationChannel(
  data: NotificationChannelPayload,
): Promise<NotificationChannel> {
  const res = await rbacApi.post("/notification-channels", data);
  return res.data;
}

export async function updateNotificationChannel(
  id: number,
  data: NotificationChannelPayload,
): Promise<NotificationChannel> {
  const res = await rbacApi.put(`/notification-channels/${id}`, data);
  return res.data;
}

export async function deleteNotificationChannel(id: number): Promise<void> {
  await rbacApi.delete(`/notification-channels/${id}`);
}

export async function testNotificationChannel(id: number): Promise<void> {
  const res = await rbacApi.post(`/notification-channels/${id}/test`);
  const data = res.data as { success?: boolean; error?: string };
  if (data && data.success === false) {
    throw new Error(data.error || "Test notification failed");
  }
}
