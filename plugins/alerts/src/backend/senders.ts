import type { PluginFetch } from "@termix/plugin-sdk/backend";
import type { AlertLink, ChannelType, Severity } from "../types.js";

export interface OutgoingAlert {
  title: string;
  body: string;
  severity: Severity;
  category: string;
  source: string;
  link?: AlertLink | null;
  context?: Record<string, unknown> | null;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface SendMail {
  (
    smtp: SmtpSettings,
    message: {
      to: string[];
      subject: string;
      text: string;
    },
  ): Promise<void>;
}

export interface SenderDeps {
  fetch: PluginFetch;
  /** Hosts the admin lets channels reach on a private network. */
  privateAllowlist: () => Promise<string[]>;
  smtp: () => Promise<SmtpSettings | null>;
  sendMail: SendMail;
}

const NTFY_PRIORITY: Record<Severity, number> = {
  info: 2,
  success: 2,
  warning: 3,
  critical: 5,
};

const NTFY_TAGS: Record<Severity, string> = {
  info: "information_source",
  success: "white_check_mark",
  warning: "warning",
  critical: "rotating_light",
};

const DISCORD_COLORS: Record<Severity, number> = {
  info: 3447003,
  success: 3066993,
  warning: 16753920,
  critical: 15158332,
};

export const DISCORD_WEBHOOK =
  /^https:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/.+/i;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function parseRecipients(value: unknown): string[] {
  return str(value)
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** What is wrong with a channel's config, or null when it can be saved. */
export function validateChannelConfig(
  type: ChannelType,
  config: Record<string, unknown>,
): string | null {
  switch (type) {
    case "webhook":
      return /^https?:\/\//i.test(str(config.url))
        ? null
        : "webhook config requires an http(s) url";
    case "ntfy":
      if (!/^https?:\/\//i.test(str(config.url))) {
        return "ntfy config requires an http(s) url";
      }
      return str(config.topic) ? null : "ntfy config requires a topic";
    case "discord":
      return DISCORD_WEBHOOK.test(str(config.url))
        ? null
        : "discord config requires a Discord webhook URL";
    case "email": {
      const to = parseRecipients(config.to);
      if (to.length === 0) return "email config requires at least one address";
      return to.every((address) => EMAIL.test(address))
        ? null
        : "email config has an invalid address";
    }
  }
}

function linkUrl(alert: OutgoingAlert): string | undefined {
  const url = alert.link?.url;
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * Sends one alert to one channel and throws on failure, so the caller can say
 * which channel failed. Private and loopback targets need both the channel's
 * allowPrivateNetwork opt-in and an exact host in the admin allowlist.
 */
export async function sendToChannel(
  channel: { type: ChannelType; config: Record<string, unknown> },
  alert: OutgoingAlert,
  deps: SenderDeps,
): Promise<void> {
  const { config } = channel;

  if (channel.type === "email") {
    const smtp = await deps.smtp();
    if (!smtp) throw new Error("Email is not set up on this server");
    const to = parseRecipients(config.to);
    if (to.length === 0) throw new Error("Channel has no email address");
    const url = linkUrl(alert);
    await deps.sendMail(smtp, {
      to,
      subject: `[Termix] ${alert.title}`,
      text: [alert.body || alert.title, url].filter(Boolean).join("\n\n"),
    });
    return;
  }

  const allowPrivateHosts =
    config.allowPrivateNetwork === true ? await deps.privateAllowlist() : [];
  const post = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    const response = await deps.fetch(url, {
      ...init,
      timeoutMs: 30_000,
      allowPrivateHosts,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
  };

  const url = str(config.url);
  if (!url) throw new Error("Channel is missing a URL");
  const context = alert.context ?? {};

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
          title: alert.title,
          message: alert.body,
          severity: alert.severity,
          category: alert.category,
          source: alert.source,
          link: linkUrl(alert),
          hostName: context.hostName,
          hostId: context.hostId,
          ruleName: context.sourceName ?? alert.title,
          ruleId: context.sourceId,
          triggerType: context.triggerType,
          value: context.value,
          threshold: context.threshold,
          timestamp: new Date().toISOString(),
        }),
      });
    }
    case "ntfy": {
      const topic = str(config.topic);
      if (!topic) throw new Error("ntfy channel is missing a topic");
      const headers: Record<string, string> = {
        Title: alert.title || "Termix",
        Priority: String(NTFY_PRIORITY[alert.severity]),
        Tags: NTFY_TAGS[alert.severity],
      };
      const click = linkUrl(alert);
      if (click) headers.Click = click;
      const token = str(config.token);
      if (token) headers.Authorization = `Bearer ${token}`;
      return post(`${url.replace(/\/$/, "")}/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers,
        body: alert.body || alert.title,
      });
    }
    case "discord": {
      const embed: Record<string, unknown> = {
        title: alert.title || "Termix",
        description: alert.body || undefined,
        color: DISCORD_COLORS[alert.severity],
        timestamp: new Date().toISOString(),
      };
      const click = linkUrl(alert);
      if (click) embed.url = click;
      const payload: Record<string, unknown> = { embeds: [embed] };
      if (str(config.username)) payload.username = str(config.username);
      if (str(config.avatar_url)) payload.avatar_url = str(config.avatar_url);
      return post(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  }
}
