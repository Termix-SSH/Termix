import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  alertFirings,
  alertRuleChannels,
  alertRules,
  hosts,
  notificationChannels,
} from "../db/schema.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import type { DatabaseContext } from "./database-context.js";
import { sqlTimestampDaysAgo } from "./sql-timestamp.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

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

  /**
   * Channel configs carry ntfy tokens and webhook auth headers, so they are
   * field-encrypted like any other secret. The key is derived from the row id,
   * which does not exist until after the insert, so a new channel is written
   * once and then re-encrypted in place with its real id.
   */
  private userDataKey(userId: string): Buffer | null {
    try {
      return DataCrypto.getUserDataKey(userId);
    } catch {
      // Crypto is not initialized (tests, early boot); leave the value as is.
      return null;
    }
  }

  private encryptConfig(
    config: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return config;
    return DataCrypto.encryptRecord(
      "notification_channels",
      { id: recordId, config },
      userId,
      userDataKey,
    ).config;
  }

  private decryptConfig(
    config: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return config;
    try {
      return DataCrypto.decryptRecord(
        "notification_channels",
        { id: recordId, config },
        userId,
        userDataKey,
      ).config;
    } catch {
      // Rows written before channel configs were encrypted are still plaintext.
      return config;
    }
  }

  async listNotificationChannels(
    userId: string,
  ): Promise<NotificationChannelRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .orderBy(notificationChannels.id);

    return rows.map((row) => {
      const mapped = mapChannelRow(row);
      mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
      return mapped;
    });
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

    if (!rows[0]) return null;
    const mapped = mapChannelRow(rows[0]);
    mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
    return mapped;
  }

  async createNotificationChannel(input: {
    userId: string;
    name: string;
    type: string;
    config: string;
    enabled: boolean;
  }): Promise<NotificationChannelRow> {
    const [created] = await insertReturning(
      this.context,
      notificationChannels,
      {
        userId: input.userId,
        name: input.name,
        type: input.type,
        config: input.config,
        enabled: input.enabled,
      },
    );

    const encrypted = this.encryptConfig(
      input.config,
      input.userId,
      created.id,
    );
    if (encrypted !== input.config) {
      await this.context.drizzle
        .update(notificationChannels)
        .set({ config: encrypted })
        .where(eq(notificationChannels.id, created.id));
    }

    await this.afterWrite();
    const mapped = mapChannelRow(created);
    mapped.config = input.config;
    return mapped;
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

    const values =
      input.config !== undefined
        ? { ...input, config: this.encryptConfig(input.config, userId, id) }
        : input;

    const [updated] = await updateReturning(
      this.context,
      notificationChannels,
      values,
      and(
        eq(notificationChannels.id, id),
        eq(notificationChannels.userId, userId),
      ),
    );

    if (!updated) return null;
    await this.afterWrite();
    const mapped = mapChannelRow(updated);
    mapped.config = this.decryptConfig(mapped.config, userId, mapped.id);
    return mapped;
  }

  async deleteNotificationChannel(
    id: number,
    userId: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, id),
          eq(notificationChannels.userId, userId),
        ),
      );

    if (rowsAffected(result) === 0) return false;
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
    const [created] = await insertReturning(this.context, alertRules, {
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
    });

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
    const [updated] = await updateReturning(
      this.context,
      alertRules,
      {
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
      },
      and(eq(alertRules.id, id), eq(alertRules.userId, userId)),
    );

    if (!updated) return null;

    const channels =
      input.channels === undefined
        ? await this.listChannelIdsForRule(id)
        : await this.replaceRuleChannels(id, userId, input.channels);

    await this.afterWrite();
    return { ...mapRuleRow(updated), channels };
  }

  async deleteAlertRule(id: number, userId: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)));

    if (rowsAffected(result) === 0) return false;
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

  // A rule with host_id IS NULL means "all my hosts", not "all hosts on the
  // server". Without joining the host back to its owner, every user's wildcard
  // rule fired for every polled host and leaked other users' host names into
  // their alerts.
  async listEnabledRulesForHost(hostId: number): Promise<AlertEngineRule[]> {
    const rows = await this.context.drizzle
      .select({ rule: alertRules })
      .from(alertRules)
      .innerJoin(hosts, eq(hosts.id, hostId))
      .where(
        and(
          eq(alertRules.enabled, true),
          or(
            eq(alertRules.hostId, hostId),
            and(isNull(alertRules.hostId), eq(alertRules.userId, hosts.userId)),
          ),
        ),
      );
    return rows.map((row) => mapEngineRule(row.rule));
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

  async pruneFiringsOlderThan(userId: string, days: number): Promise<void> {
    await this.context.drizzle
      .delete(alertFirings)
      .where(
        and(
          eq(alertFirings.userId, userId),
          lt(alertFirings.firedAt, sqlTimestampDaysAgo(days)),
        ),
      );
  }

  async deleteByUserId(userId: string): Promise<{
    firingsDeleted: number;
    ruleLinksDeleted: number;
    rulesDeleted: number;
    channelsDeleted: number;
  }> {
    const ruleIds = (
      await this.context.drizzle
        .select({ id: alertRules.id })
        .from(alertRules)
        .where(eq(alertRules.userId, userId))
    ).map((row) => row.id);
    const channelIds = (
      await this.context.drizzle
        .select({ id: notificationChannels.id })
        .from(notificationChannels)
        .where(eq(notificationChannels.userId, userId))
    ).map((row) => row.id);

    const firingResult = await this.context.drizzle
      .delete(alertFirings)
      .where(eq(alertFirings.userId, userId));

    const linkFilters = [
      ...(ruleIds.length > 0
        ? [inArray(alertRuleChannels.ruleId, ruleIds)]
        : []),
      ...(channelIds.length > 0
        ? [inArray(alertRuleChannels.channelId, channelIds)]
        : []),
    ];
    const linkResult =
      linkFilters.length === 0
        ? null
        : await this.context.drizzle
            .delete(alertRuleChannels)
            .where(or(...linkFilters));

    const ruleResult = await this.context.drizzle
      .delete(alertRules)
      .where(eq(alertRules.userId, userId));
    const result = await this.context.drizzle
      .delete(notificationChannels)
      .where(eq(notificationChannels.userId, userId));

    if (
      rowsAffected(firingResult) > 0 ||
      rowsAffected(linkResult) > 0 ||
      rowsAffected(ruleResult) > 0 ||
      rowsAffected(result) > 0
    ) {
      await this.afterWrite();
    }

    return {
      firingsDeleted: rowsAffected(firingResult),
      ruleLinksDeleted: rowsAffected(linkResult),
      rulesDeleted: rowsAffected(ruleResult),
      channelsDeleted: rowsAffected(result),
    };
  }

  async listEnabledChannelsForRule(
    ruleId: number,
  ): Promise<AlertEngineChannel[]> {
    const rows = await this.context.drizzle
      .select({
        id: notificationChannels.id,
        userId: notificationChannels.userId,
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

    // The engine sends without a user in scope, so decrypt against the owner.
    return rows.map(({ userId, ...channel }) => ({
      ...channel,
      config: this.decryptConfig(channel.config, userId, channel.id),
    }));
  }

  async getHostDisplayName(hostId: number): Promise<string | null> {
    const rows = await this.context.drizzle
      .select({ name: hosts.name, ip: hosts.ip })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);

    const row = rows[0];
    return row ? row.name || row.ip : null;
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
