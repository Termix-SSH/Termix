import { safeOutboundFetch } from "./safe-outbound-fetch.js";
import { statsLogger } from "./logger.js";

export interface DiscordConfig {
  url: string;
  username?: string;
  avatar_url?: string;
}

import type { AlertPayload } from "./notification-sender.js";

async function fetchWithRetry(
  url: string,
  options: RequestInit,
): Promise<void> {
  const attempt = async () => {
    const res = await safeOutboundFetch(url, options);
    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `HTTP ${res.status}: ${res.statusText}${body ? ` - ${body}` : ""}`,
      );
    }
  };

  try {
    await attempt();
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await attempt();
    } catch (secondErr) {
      statsLogger.warn("Discord notification delivery failed after retry", {
        operation: "discord_notification_send_failed",
        url,
        error:
          secondErr instanceof Error ? secondErr.message : String(secondErr),
      });
      throw secondErr;
    }
  }
}

export async function sendDiscord(
  config: DiscordConfig,
  payload: AlertPayload,
): Promise<void> {
  const { url, username, avatar_url } = config;
  const colorMap: Record<string, number> = {
    info: 3066993,
    warning: 16753920,
    critical: 15158332,
  };
  const color = colorMap[payload.severity] ?? 3447003;

  const embed: Record<string, unknown> = {
    title: `[Termix] ${payload.hostName}: ${payload.ruleName}`,
    description: payload.message,
    color,
    fields: [
      { name: "Host", value: payload.hostName || "—", inline: true },
      { name: "Rule", value: payload.ruleName || "—", inline: true },
      { name: "Severity", value: payload.severity, inline: true },
    ],
    timestamp: payload.timestamp,
  } as Record<string, unknown>;

  if (payload.value !== undefined && payload.value !== null) {
    (embed.fields as any).push({
      name: "Value",
      value: String(payload.value),
      inline: true,
    });
  }

  const body: Record<string, unknown> = { embeds: [embed] };
  if (username) (body as any).username = username;
  if (avatar_url) (body as any).avatar_url = avatar_url;

  await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
