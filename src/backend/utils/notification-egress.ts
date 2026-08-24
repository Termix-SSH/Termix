import { createCurrentSettingsRepository } from "../database/repositories/factory.js";

export const NOTIFICATION_PRIVATE_ALLOWLIST_KEY =
  "notification_private_endpoint_allowlist";

export function parseNotificationAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function readNotificationPrivateAllowlist(): Promise<string[]> {
  const raw = await createCurrentSettingsRepository().get(
    NOTIFICATION_PRIVATE_ALLOWLIST_KEY,
  );
  return parseNotificationAllowlist(raw);
}
