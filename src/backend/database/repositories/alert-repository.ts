import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import {
  alertFirings,
  alertRuleChannels,
  alertRules,
  notificationChannels,
} from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

type AlertRuleRecord = typeof alertRules.$inferSelect;
type NotificationChannelRecord = typeof notificationChannels.$inferSelect;
type AlertFiringRecord = typeof alertFirings.$inferSelect;

export interface NotificationChannelRow {
  id: number;
  user_id: string;
  name: string;
  type: string;
  config: string;
  enabled: number;
  created_at: string;
}

export interface AlertRuleRow {
  id: number;
  user_id: string;
  host_id: number | null;
  name: string;
  enabled: number;
  trigger_type: string;
  threshold_value: number | null;
  threshold_duration_seconds: number | null;
  cooldown_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleWithChannelsRow extends AlertRuleRow {
  channels: number[];
}

export interface AlertFiringRow {
  id: number;
  user_id: string;
  rule_id: number;
  host_id: number;
  host_name: string;
  fired_at: string;
  resolved_at: string | null;
  value: number | null;
  message: string;
  severity: string;
  acknowledged: number;
  rule_name: string | null;
}

export interface AlertEngineRule {
  id: number;
  userId: string;
  hostId: number | null;
  name: string;
  enabled: boolean;
  triggerType: string;
  thresholdValue: number | null;
  thresholdDurationSeconds: number | null;
  cooldownMinutes: number;
}

export interface AlertEngineChannel {
  id: number;
  type: string;
  config: string;
  enabled: boolean;
}

export class AlertRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listNotificationChannels(
    userId: string,
  ): Promise<NotificationChannelRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .orderBy(notificationChannels.id);

    return rows.map(mapChannelRow);
  }

  async findNotificationChannelForUser(
    id: number,
    userId: string,
  ): Promise<NotificationChannelRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      )
      .limit(1);

    return rows[0] ? mapChannelRow(rows[0]) : null;
  }

  async createNotificationChannel(input: {
    userId: string;
    name: string;
    type: string;
    config: string;
    enabled: boolean;
  }): Promise<NotificationChannelRow> {
    const [created] = await this.context.drizzle
      .insert(notificationChannels)
      .values({
        userId: input.userId,
        name: input.name,
        type: input.type,
        config: input.config,
        enabled: input.enabled,
      })
      .returning();

    await this.afterWrite();
    return mapChannelRow(created);
  }

  async updateNotificationChannel(
    id: number,
    userId: string,
    input: {
      name?: string;
      type?: string;
      config?: string;
      enabled?: boolean;
    },
  ): Promise<NotificationChannelRow | null> {
    if (Object.keys(input).length === 0) {
      return this.findNotificationChannelForUser(id, userId);
    }

    const [updated] = await this.context.drizzle
      .update(notificationChannels)
      .set(input)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      )
      .returning();

    if (!updated) return null;
    await this.afterWrite();
    return mapChannelRow(updated);
  }

  async deleteNotificationChannel(
    id: number,
    userId: string,
  ): Promise<boolean> {
    const deleted = await this.context.drizzle
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      )
      .returning({ id: notificationChannels.id });

    if (deleted.length === 0) return false;
    await this.afterWrite();
    return true;
  }

  async listAlertRules(userId: string): Promise<AlertRuleWithChannelsRow[]> {
    const rules = await this.context.drizzle
      .select()
      .from(alertRules)
      .where(eq(alertRules.userId, userId))
      .orderBy(alertRules.id);

    const result: AlertRuleWithChannelsRow[] = [];
    for (const rule of rules) {
      result.push({
        ...mapRuleRow(rule),
        channels: await this.listChannelIdsForRule(rule.id),
      });
    }
    return result;
  }

  async createAlertRule(input: {
    userId: string;
    hostId: number | null;
    name: string;
    enabled: boolean;
    triggerType: string;
    thresholdValue: number | null;
    thresholdDurationSeconds: number | null;
    cooldownMinutes: number;
    channels: number[];
    now: string;
  }): Promise<AlertRuleWithChannelsRow> {
    const [created] = await this.context.drizzle
      .insert(alertRules)
      .values({
        userId: input.userId,
        hostId: input.hostId,
        name: input.name,
        enabled: input.enabled,
        triggerType: input.triggerType,
        thresholdValue: input.thresholdValue,
        thresholdDurationSeconds: input.thresholdDurationSeconds,
        cooldownMinutes: input.cooldownMinutes,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();

    const channels = await this.replaceRuleChannels(
      created.id,
      input.userId,
      input.channels,
    );
    await this.afterWrite();
    return { ...mapRuleRow(created), channels };
  }

  async findAlertRuleForUser(
    id: number,
    userId: string,
  ): Promise<AlertRuleRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .limit(1);

    return rows[0] ? mapRuleRow(rows[0]) : null;
  }

  async updateAlertRule(
    id: number,
    userId: string,
    input: {
      name?: string;
      hostId?: number | null;
      enabled?: boolean;
      triggerType?: string;
      thresholdValue?: number | null;
      thresholdDurationSeconds?: number | null;
      cooldownMinutes?: number;
      channels?: number[];
      now: string;
    },
  ): Promise<AlertRuleWithChannelsRow | null> {
    const [updated] = await this.context.drizzle
      .update(alertRules)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.hostId !== undefined ? { hostId: input.hostId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.triggerType !== undefined
          ? { triggerType: input.triggerType }
          : {}),
        ...(input.thresholdValue !== undefined
          ? { thresholdValue: input.thresholdValue }
          : {}),
        ...(input.thresholdDurationSeconds !== undefined
          ? { thresholdDurationSeconds: input.thresholdDurationSeconds }
          : {}),
        ...(input.cooldownMinutes !== undefined
          ? { cooldownMinutes: input.cooldownMinutes }
          : {}),
        updatedAt: input.now,
      })
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .returning();

    if (!updated) return null;

    const channels =
      input.channels === undefined
        ? await this.listChannelIdsForRule(id)
        : await this.replaceRuleChannels(id, userId, input.channels);

    await this.afterWrite();
    return { ...mapRuleRow(updated), channels };
  }

  async deleteAlertRule(id: number, userId: string): Promise<boolean> {
    const deleted = await this.context.drizzle
      .delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .returning({ id: alertRules.id });

    if (deleted.length === 0) return false;
    await this.afterWrite();
    return true;
  }

  async listAlertFirings(input: {
    userId: string;
    acknowledged?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ firings: AlertFiringRow[]; total: number }> {
    const filters = [eq(alertFirings.userId, input.userId)];
    if (input.acknowledged !== undefined) {
      filters.push(eq(alertFirings.acknowledged, input.acknowledged));
    }

    const where = and(...filters);
    const rows = await this.context.drizzle
      .select({
        firing: alertFirings,
        ruleName: alertRules.name,
      })
      .from(alertFirings)
      .leftJoin(alertRules, eq(alertRules.id, alertFirings.ruleId))
      .where(where)
      .orderBy(desc(alertFirings.firedAt))
      .limit(input.limit)
      .offset(input.offset);

    const totalRows = await this.context.drizzle
      .select({ total: count() })
      .from(alertFirings)
      .where(where);

    return {
      firings: rows.map((row) => mapFiringRow(row.firing, row.ruleName)),
      total: totalRows[0]?.total ?? 0,
    };
  }

  async acknowledgeFiring(id: number, userId: string): Promise<void> {
    await this.context.drizzle
      .update(alertFirings)
      .set({ acknowledged: true })
      .where(and(eq(alertFirings.id, id), eq(alertFirings.userId, userId)));
    await this.afterWrite();
  }

  async acknowledgeAllFirings(userId: string): Promise<void> {
    await this.context.drizzle
      .update(alertFirings)
      .set({ acknowledged: true })
      .where(eq(alertFirings.userId, userId));
    await this.afterWrite();
  }

  async listEnabledRulesForHost(hostId: number): Promise<AlertEngineRule[]> {
    const rows = await this.context.drizzle
      .select()
      .from(alertRules)
      .where(
        and(
          eq(alertRules.enabled, true),
          or(eq(alertRules.hostId, hostId), isNull(alertRules.hostId)),
        ),
      );
    return rows.map(mapEngineRule);
  }

  async listEnabledRulesForHostUser(
    hostId: number,
    userId: string,
  ): Promise<AlertEngineRule[]> {
    const rows = await this.context.drizzle
      .select()
      .from(alertRules)
      .where(
        and(
          eq(alertRules.enabled, true),
          eq(alertRules.userId, userId),
          or(eq(alertRules.hostId, hostId), isNull(alertRules.hostId)),
        ),
      );
    return rows.map(mapEngineRule);
  }

  async findRuleById(id: number): Promise<AlertEngineRule | null> {
    const rows = await this.context.drizzle
      .select()
      .from(alertRules)
      .where(eq(alertRules.id, id))
      .limit(1);
    return rows[0] ? mapEngineRule(rows[0]) : null;
  }

  async createFiring(input: {
    userId: string;
    ruleId: number;
    hostId: number;
    hostName: string;
    value: number | null;
    message: string;
    severity: string;
  }): Promise<void> {
    await this.context.drizzle.insert(alertFirings).values(input);
    await this.afterWrite();
  }

  pruneFiringsOlderThan(userId: string, days: number): void {
    this.context.sqlite
      ?.prepare(
        "DELETE FROM alert_firings WHERE user_id = ? AND fired_at < datetime('now', ?)",
      )
      .run(userId, `-${days} days`);
  }

  async listEnabledChannelsForRule(
    ruleId: number,
  ): Promise<AlertEngineChannel[]> {
    const rows = await this.context.drizzle
      .select({
        id: notificationChannels.id,
        type: notificationChannels.type,
        config: notificationChannels.config,
        enabled: notificationChannels.enabled,
      })
      .from(notificationChannels)
      .innerJoin(
        alertRuleChannels,
        eq(alertRuleChannels.channelId, notificationChannels.id),
      )
      .where(
        and(
          eq(alertRuleChannels.ruleId, ruleId),
          eq(notificationChannels.enabled, true),
        ),
      );

    return rows;
  }

  private async replaceRuleChannels(
    ruleId: number,
    userId: string,
    channelIds: number[],
  ): Promise<number[]> {
    await this.context.drizzle
      .delete(alertRuleChannels)
      .where(eq(alertRuleChannels.ruleId, ruleId));

    const linked: number[] = [];
    for (const channelId of channelIds) {
      const channel = await this.findNotificationChannelForUser(
        channelId,
        userId,
      );
      if (!channel) continue;
      await this.context.drizzle
        .insert(alertRuleChannels)
        .values({ ruleId, channelId });
      linked.push(channelId);
    }
    return linked;
  }

  private async listChannelIdsForRule(ruleId: number): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ channelId: alertRuleChannels.channelId })
      .from(alertRuleChannels)
      .where(eq(alertRuleChannels.ruleId, ruleId));

    return rows.map((row) => row.channelId);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}

function mapChannelRow(row: NotificationChannelRecord): NotificationChannelRow {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    type: row.type,
    config: row.config,
    enabled: row.enabled ? 1 : 0,
    created_at: row.createdAt,
  };
}

function mapRuleRow(row: AlertRuleRecord): AlertRuleRow {
  return {
    id: row.id,
    user_id: row.userId,
    host_id: row.hostId,
    name: row.name,
    enabled: row.enabled ? 1 : 0,
    trigger_type: row.triggerType,
    threshold_value: row.thresholdValue,
    threshold_duration_seconds: row.thresholdDurationSeconds,
    cooldown_minutes: row.cooldownMinutes,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapFiringRow(
  row: AlertFiringRecord,
  ruleName: string | null,
): AlertFiringRow {
  return {
    id: row.id,
    user_id: row.userId,
    rule_id: row.ruleId,
    host_id: row.hostId,
    host_name: row.hostName,
    fired_at: row.firedAt,
    resolved_at: row.resolvedAt,
    value: row.value,
    message: row.message,
    severity: row.severity,
    acknowledged: row.acknowledged ? 1 : 0,
    rule_name: ruleName,
  };
}

function mapEngineRule(row: AlertRuleRecord): AlertEngineRule {
  return {
    id: row.id,
    userId: row.userId,
    hostId: row.hostId,
    name: row.name,
    enabled: row.enabled,
    triggerType: row.triggerType,
    thresholdValue: row.thresholdValue,
    thresholdDurationSeconds: row.thresholdDurationSeconds,
    cooldownMinutes: row.cooldownMinutes,
  };
}
