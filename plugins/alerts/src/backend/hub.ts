import type {
  PluginNotification,
  PluginNotifyHub,
  PluginNotifyResult,
} from "@termix/plugin-sdk/backend";
import {
  isSeverity,
  matchesCategory,
  severityRank,
  type AlertLink,
  type DeliveryResult,
} from "../types.js";
import type { AlertsRepository, DeliverableChannel } from "./repository.js";
import {
  sendToChannel,
  type OutgoingAlert,
  type SenderDeps,
} from "./senders.js";
import type { AlertStream } from "./stream.js";

const MAX_TITLE = 200;
const MAX_BODY = 4000;
const MAX_CONTEXT = 8000;
const TAB_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface HubDeps {
  repository: AlertsRepository;
  stream: AlertStream;
  senders: SenderDeps;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cleanLink(link: unknown): AlertLink | null {
  if (!link || typeof link !== "object") return null;
  const { tab, url } = link as Record<string, unknown>;
  const clean: AlertLink = {};
  if (typeof tab === "string" && TAB_ID.test(tab)) clean.tab = tab;
  if (typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim())) {
    clean.url = url.trim().slice(0, 2000);
  }
  return clean.tab || clean.url ? clean : null;
}

function cleanContext(context: unknown): Record<string, unknown> | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }
  try {
    const text = JSON.stringify(context);
    return text.length <= MAX_CONTEXT
      ? (JSON.parse(text) as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Sends to each channel and reports how each one went. */
export async function deliverToChannels(
  targets: DeliverableChannel[],
  alert: OutgoingAlert,
  senders: SenderDeps,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  for (const channel of targets) {
    if (!channel.config) {
      results.push({
        channelId: channel.id,
        name: channel.name,
        ok: false,
        error: "Channel needs to be saved again before it can send",
      });
      continue;
    }
    try {
      await sendToChannel(
        { type: channel.type, config: channel.config },
        alert,
        senders,
      );
      results.push({ channelId: channel.id, name: channel.name, ok: true });
    } catch (error) {
      results.push({
        channelId: channel.id,
        name: channel.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export function createHub(deps: HubDeps): PluginNotifyHub {
  const { repository, stream, senders } = deps;

  async function deliverOne(
    userId: string,
    source: string,
    notification: PluginNotification,
    result: PluginNotifyResult,
  ): Promise<void> {
    const severity = isSeverity(notification.severity)
      ? notification.severity
      : "warning";
    const category = clip(notification.category, 128) || source;
    const dedupeKey = clip(notification.dedupeKey, 255) || null;
    if (dedupeKey && (await repository.hasUnreadWithKey(userId, dedupeKey))) {
      return;
    }

    const title = clip(notification.title, MAX_TITLE) || category;
    const body = clip(notification.body, MAX_BODY);
    const link = cleanLink(notification.link);
    const context = cleanContext(notification.context);
    const item = await repository.insertItem({
      userId,
      source,
      category,
      severity,
      title,
      body: body || null,
      link,
      context,
      dedupeKey,
    });
    result.recipients++;
    stream.publish(userId, "item", item);
    stream.publish(userId, "unread", {
      count: await repository.unreadCount(userId),
    });

    const wanted = new Set<number>(
      (notification.channelIds ?? []).filter(Number.isInteger),
    );
    for (const rule of await repository.listRules(userId)) {
      if (!rule.enabled) continue;
      if (severityRank(severity) < severityRank(rule.minSeverity)) continue;
      if (!matchesCategory(rule.match, category)) continue;
      for (const id of rule.channelIds) wanted.add(id);
    }
    if (wanted.size === 0) return;

    const targets = (await repository.deliverableChannels(userId)).filter(
      (channel) => channel.enabled && wanted.has(channel.id),
    );
    if (targets.length === 0) return;

    const deliveries = await deliverToChannels(
      targets,
      { title, body, severity, category, source, link, context },
      senders,
    );
    for (const delivery of deliveries) {
      if (delivery.ok) result.delivered++;
      else {
        result.failures.push({
          channelId: delivery.channelId,
          name: delivery.name,
          error: delivery.error ?? "",
        });
      }
    }
    await repository.setDeliveries(item.id, deliveries);
    stream.publish(userId, "item", { ...item, deliveries });
  }

  return {
    async deliver({ source, recipients, notification }) {
      const result: PluginNotifyResult = {
        recipients: 0,
        delivered: 0,
        failures: [],
      };
      for (const userId of new Set(recipients)) {
        await deliverOne(userId, source, notification, result);
      }
      return result;
    },

    async channels(userId) {
      return (await repository.listChannels(userId)).map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
      }));
    },
  };
}
