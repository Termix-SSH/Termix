import { statsLogger } from "./logger.js";

export interface AlertPayload {
  hostName: string;
  hostId: number;
  triggerType: string;
  value?: number;
  threshold?: number;
  message: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  ruleId: number;
  ruleName: string;
}

interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  method?: "POST" | "PUT";
}

interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
}

const NTFY_PRIORITY: Record<string, number> = {
  info: 2,
  warning: 3,
  critical: 5,
};

async function fetchWithRetry(
  url: string,
  options: RequestInit,
): Promise<void> {
  const attempt = async () => {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  };

  try {
    await attempt();
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await attempt();
    } catch (secondErr) {
      statsLogger.warn("Notification delivery failed after retry", {
        operation: "notification_send_failed",
        url,
        error:
          secondErr instanceof Error ? secondErr.message : String(secondErr),
      });
    }
  }
}

export async function sendWebhook(
  config: WebhookConfig,
  payload: AlertPayload,
): Promise<void> {
  const { url, headers = {}, method = "POST" } = config;
  await fetchWithRetry(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

export async function sendNtfy(
  config: NtfyConfig,
  payload: AlertPayload,
): Promise<void> {
  const { url, topic, token } = config;
  const ntfyUrl = `${url.replace(/\/$/, "")}/${topic}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Title: `[Termix] ${payload.hostName}: ${payload.ruleName}`,
    Priority: String(NTFY_PRIORITY[payload.severity] ?? 3),
    Tags:
      payload.severity === "critical"
        ? "rotating_light"
        : payload.severity === "warning"
          ? "warning"
          : "information_source",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  await fetchWithRetry(ntfyUrl, {
    method: "POST",
    headers,
    body: payload.message,
  });
}

export interface NotificationChannel {
  id: number;
  type: string;
  config: string;
  enabled: boolean;
}

export async function sendNotification(
  channel: NotificationChannel,
  payload: AlertPayload,
): Promise<void> {
  if (!channel.enabled) return;

  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = JSON.parse(channel.config) as Record<string, unknown>;
  } catch {
    statsLogger.warn("Failed to parse notification channel config", {
      operation: "notification_config_parse_error",
      channelId: channel.id,
    });
    return;
  }

  try {
    if (channel.type === "webhook") {
      await sendWebhook(parsedConfig as unknown as WebhookConfig, payload);
    } else if (channel.type === "ntfy") {
      await sendNtfy(parsedConfig as unknown as NtfyConfig, payload);
    }
  } catch (err) {
    statsLogger.warn("Notification send error", {
      operation: "notification_send_error",
      channelId: channel.id,
      type: channel.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
