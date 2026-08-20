import { statsLogger } from "../utils/logger.js";
import { automationFetch } from "./http.js";
import type { TemplateContext } from "./template.js";

/**
 * Notification delivery for automations.
 *
 * The alert engine special-cased Discord because its dispatcher only knew
 * webhook and ntfy; here every transport goes through one switch, so adding a
 * channel type is a single edit.
 */
export interface AutomationChannel {
  id: number;
  type: string;
  config: string;
}

export interface AutomationNotification {
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  context?: TemplateContext;
}

const NTFY_PRIORITY: Record<string, number> = {
  info: 2,
  warning: 3,
  critical: 5,
};

const NTFY_TAGS: Record<string, string> = {
  info: "information_source",
  warning: "warning",
  critical: "rotating_light",
};

const DISCORD_COLORS: Record<string, number> = {
  info: 3066993,
  warning: 16753920,
  critical: 15158332,
};

export async function sendAutomationNotification(
  channel: AutomationChannel,
  notification: AutomationNotification,
): Promise<void> {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(channel.config) as Record<string, unknown>;
  } catch {
    throw new Error("Channel configuration is not valid JSON");
  }

  const allowPrivateNetwork = config.allowPrivateNetwork === true;

  switch (channel.type) {
    case "webhook":
      return sendWebhook(config, notification, allowPrivateNetwork);
    case "ntfy":
      return sendNtfy(config, notification, allowPrivateNetwork);
    case "discord":
      return sendDiscord(config, notification, allowPrivateNetwork);
    default:
      throw new Error(`Unsupported channel type: ${channel.type}`);
  }
}

function requireUrl(config: Record<string, unknown>): string {
  const url = typeof config.url === "string" ? config.url.trim() : "";
  if (!url) throw new Error("Channel is missing a URL");
  return url;
}

async function sendWebhook(
  config: Record<string, unknown>,
  notification: AutomationNotification,
  allowPrivateNetwork: boolean,
): Promise<void> {
  const url = requireUrl(config);
  const method = config.method === "PUT" ? "PUT" : "POST";
  const headers =
    config.headers && typeof config.headers === "object"
      ? (config.headers as Record<string, string>)
      : {};

  const response = await automationFetch(url, {
    method,
    headers,
    body: JSON.stringify({
      title: notification.title,
      hostName:
        notification.context?.host?.name ??
        notification.context?.trigger?.hostName,
      hostId:
        notification.context?.host?.id ??
        notification.context?.trigger?.hostId,
      ruleName: notification.title,
      ruleId: notification.context?.run?.automationId,
      triggerType: notification.context?.trigger?.type,
      value: notification.context?.trigger?.value,
      threshold: notification.context?.trigger?.threshold,
      message: notification.body,
      severity: notification.severity,
      timestamp: new Date().toISOString(),
    }),
    allowPrivateNetwork,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
}

async function sendNtfy(
  config: Record<string, unknown>,
  notification: AutomationNotification,
  allowPrivateNetwork: boolean,
): Promise<void> {
  const base = requireUrl(config).replace(/\/$/, "");
  const topic = typeof config.topic === "string" ? config.topic.trim() : "";
  if (!topic) throw new Error("ntfy channel is missing a topic");

  const headers: Record<string, string> = {
    Title: notification.title || "Termix automation",
    Priority: String(NTFY_PRIORITY[notification.severity] ?? 3),
    Tags: NTFY_TAGS[notification.severity] ?? "information_source",
  };
  if (typeof config.token === "string" && config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const response = await automationFetch(`${base}/${topic}`, {
    method: "POST",
    headers,
    body: notification.body || notification.title,
    allowPrivateNetwork,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
}

async function sendDiscord(
  config: Record<string, unknown>,
  notification: AutomationNotification,
  allowPrivateNetwork: boolean,
): Promise<void> {
  const url = requireUrl(config);
  const payload: Record<string, unknown> = {
    embeds: [
      {
        title: notification.title || "Termix automation",
        description: notification.body || undefined,
        color: DISCORD_COLORS[notification.severity] ?? 3447003,
        timestamp: new Date().toISOString(),
      },
    ],
  };
  if (typeof config.username === "string" && config.username) {
    payload.username = config.username;
  }
  if (typeof config.avatar_url === "string" && config.avatar_url) {
    payload.avatar_url = config.avatar_url;
  }

  const response = await automationFetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
    allowPrivateNetwork,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
    );
  }
}

/** Fire-and-forget wrapper for callers that must not block on delivery. */
export function sendAutomationNotificationSafely(
  channel: AutomationChannel,
  notification: AutomationNotification,
): void {
  sendAutomationNotification(channel, notification).catch((error) => {
    statsLogger.warn("Automation notification failed", {
      operation: "automation_notification_error",
      channelId: channel.id,
      type: channel.type,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
