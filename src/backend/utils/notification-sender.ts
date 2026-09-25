import { safeOutboundFetch } from "./safe-outbound-fetch.js";
import { readNotificationPrivateAllowlist } from "./notification-egress.js";

const NTFY_PRIORITY: Record<string, number> = {
  info: 2,
  warning: 3,
  critical: 5,
};

export interface ChannelNotification {
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  context?: {
    hostId?: number;
    hostName?: string;
    sourceId?: number | string;
    sourceName?: string;
    triggerType?: string;
    value?: unknown;
    threshold?: unknown;
  };
}

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

/**
 * Sends one notification to one channel and throws on failure, so the caller
 * can report which channel failed. Private and loopback targets need both the
 * channel's allowPrivateNetwork opt-in and an exact host in the admin
 * allowlist.
 */
export async function deliverNotification(
  channel: { id: number; type: string; config: string },
  notification: ChannelNotification,
): Promise<void> {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(channel.config) as Record<string, unknown>;
  } catch {
    throw new Error("Channel configuration is not valid JSON");
  }

  const allowlist =
    config.allowPrivateNetwork === true
      ? await readNotificationPrivateAllowlist()
      : [];
  const post = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await safeOutboundFetch(
        url,
        { ...init, signal: controller.signal },
        allowlist,
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const url = typeof config.url === "string" ? config.url.trim() : "";
  if (!url) throw new Error("Channel is missing a URL");
  const context = notification.context ?? {};

  switch (channel.type) {
    case "webhook": {
      const headers =
        config.headers && typeof config.headers === "object"
          ? (config.headers as Record<string, string>)
          : {};
      return post(url, {
        method: config.method === "PUT" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          title: notification.title,
          hostName: context.hostName,
          hostId: context.hostId,
          ruleName: context.sourceName ?? notification.title,
          ruleId: context.sourceId,
          triggerType: context.triggerType,
          value: context.value,
          threshold: context.threshold,
          message: notification.body,
          severity: notification.severity,
          timestamp: new Date().toISOString(),
        }),
      });
    }
    case "ntfy": {
      const topic = typeof config.topic === "string" ? config.topic.trim() : "";
      if (!topic) throw new Error("ntfy channel is missing a topic");
      const headers: Record<string, string> = {
        Title: notification.title || "Termix",
        Priority: String(NTFY_PRIORITY[notification.severity] ?? 3),
        Tags: NTFY_TAGS[notification.severity] ?? "information_source",
      };
      if (typeof config.token === "string" && config.token) {
        headers.Authorization = `Bearer ${config.token}`;
      }
      return post(`${url.replace(/\/$/, "")}/${topic}`, {
        method: "POST",
        headers,
        body: notification.body || notification.title,
      });
    }
    case "discord": {
      const payload: Record<string, unknown> = {
        embeds: [
          {
            title: notification.title || "Termix",
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
      return post(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    default:
      throw new Error(`Unsupported channel type: ${channel.type}`);
  }
}
