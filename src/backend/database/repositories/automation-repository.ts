import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import {
  automationChannels,
  automationRunSteps,
  automationRuns,
  automationSchedules,
  automationTriggerState,
  automations,
  notificationChannels,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

type AutomationRecord = typeof automations.$inferSelect;
type AutomationRunRecord = typeof automationRuns.$inferSelect;
type AutomationRunStepRecord = typeof automationRunSteps.$inferSelect;
type TriggerStateRecord = typeof automationTriggerState.$inferSelect;
type ScheduleRecord = typeof automationSchedules.$inferSelect;

export interface AutomationRow {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  enabled: number;
  definition: string;
  definition_version: number;
  concurrency_policy: string;
  max_run_seconds: number;
  dry_run: number;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
  channels: number[];
}

export interface AutomationRunRow {
  id: number;
  automation_id: number;
  user_id: string;
  trigger_type: string;
  trigger_context: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  dry_run: number;
  parent_run_id: number | null;
  automation_name?: string | null;
}

export interface AutomationRunStepRow {
  id: number;
  run_id: number;
  step_index: number;
  step_id: string;
  step_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  output: string | null;
  error: string | null;
  truncated: number;
}

/** The shape the engine loads; camelCase and already parsed where useful. */
export interface AutomationEngineRow {
  id: number;
  userId: string;
  name: string;
  enabled: boolean;
  definition: string;
  concurrencyPolicy: string;
  maxRunSeconds: number;
  dryRun: boolean;
}

export interface TriggerStateRow {
  automationId: number;
  stateKey: string;
  breachStartedAt: string | null;
  lastFiredAt: string | null;
  lastValue: number | null;
  lastObservedState: string | null;
}

export interface DueScheduleRow {
  automationId: number;
  cron: string | null;
  intervalSeconds: number | null;
  timezone: string | null;
  nextDueAt: string | null;
}

export class AutomationRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async list(userId: string): Promise<AutomationRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(automations)
      .where(eq(automations.userId, userId))
      .orderBy(asc(automations.name));

    if (rows.length === 0) return [];

    // One query for every automation's channels rather than one per row.
    const links = await this.context.drizzle
      .select({
        automationId: automationChannels.automationId,
        channelId: automationChannels.channelId,
      })
      .from(automationChannels)
      .where(
        inArray(
          automationChannels.automationId,
          rows.map((row) => row.id),
        ),
      );

    const byAutomation = new Map<number, number[]>();
    for (const link of links) {
      const list = byAutomation.get(link.automationId) ?? [];
      list.push(link.channelId);
      byAutomation.set(link.automationId, list);
    }

    return rows.map((row) => mapAutomationRow(row, byAutomation.get(row.id)));
  }

  async findForUser(id: number, userId: string): Promise<AutomationRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.userId, userId)))
      .limit(1);

    if (!rows[0]) return null;
    return mapAutomationRow(rows[0], await this.listChannelIds(id));
  }

  async findById(id: number): Promise<AutomationEngineRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1);
    return rows[0] ? mapEngineRow(rows[0]) : null;
  }

  async create(input: {
    userId: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    definition: string;
    concurrencyPolicy?: string;
    maxRunSeconds?: number;
    dryRun?: boolean;
    channels?: number[];
    now?: string;
  }): Promise<AutomationRow> {
    const now = input.now ?? new Date().toISOString();
    const [created] = await insertReturning(this.context, automations, {
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      definition: input.definition,
      concurrencyPolicy: input.concurrencyPolicy ?? "skip",
      maxRunSeconds: input.maxRunSeconds ?? 300,
      dryRun: input.dryRun ?? false,
      createdAt: now,
      updatedAt: now,
    });

    const channels = await this.replaceChannels(
      created.id,
      input.userId,
      input.channels ?? [],
    );
    await this.afterWrite();
    return mapAutomationRow(created, channels);
  }

  async update(
    id: number,
    userId: string,
    input: {
      name?: string;
      description?: string | null;
      enabled?: boolean;
      definition?: string;
      concurrencyPolicy?: string;
      maxRunSeconds?: number;
      dryRun?: boolean;
      channels?: number[];
      now?: string;
    },
  ): Promise<AutomationRow | null> {
    const { channels, now, ...fields } = input;
    const values: Record<string, unknown> = { ...fields };

    if (Object.keys(values).length > 0) {
      values.updatedAt = now ?? new Date().toISOString();
      const [updated] = await updateReturning(
        this.context,
        automations,
        values,
        and(eq(automations.id, id), eq(automations.userId, userId)),
      );
      if (!updated) return null;
    } else {
      const existing = await this.findForUser(id, userId);
      if (!existing) return null;
    }

    if (channels) {
      await this.replaceChannels(id, userId, channels);
    }

    await this.afterWrite();
    return this.findForUser(id, userId);
  }

  async delete(id: number, userId: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(automations)
      .where(and(eq(automations.id, id), eq(automations.userId, userId)));

    const deleted = rowsAffected(result) > 0;
    if (deleted) await this.afterWrite();
    return deleted;
  }

  async setEnabled(
    id: number,
    userId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(automations)
      .set({ enabled, updatedAt: new Date().toISOString() })
      .where(and(eq(automations.id, id), eq(automations.userId, userId)));

    const changed = rowsAffected(result) > 0;
    if (changed) await this.afterWrite();
    return changed;
  }

  /**
   * Enabled automations owned by whoever owns the given host. Wildcard targets
   * must never reach across users, which is the bug the alert engine shipped
   * with.
   */
  async listEnabledForUser(userId: string): Promise<AutomationEngineRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(automations)
      .where(
        and(eq(automations.enabled, true), eq(automations.userId, userId)),
      );
    return rows.map(mapEngineRow);
  }

  async listAllEnabled(): Promise<AutomationEngineRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(automations)
      .where(eq(automations.enabled, true));
    return rows.map(mapEngineRow);
  }

  // --- trigger state ---

  async getTriggerState(
    automationId: number,
    stateKey: string,
  ): Promise<TriggerStateRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(automationTriggerState)
      .where(
        and(
          eq(automationTriggerState.automationId, automationId),
          eq(automationTriggerState.stateKey, stateKey),
        ),
      )
      .limit(1);
    return rows[0] ? mapTriggerStateRow(rows[0]) : null;
  }

  async upsertTriggerState(input: {
    automationId: number;
    stateKey: string;
    breachStartedAt?: string | null;
    lastFiredAt?: string | null;
    lastValue?: number | null;
    lastObservedState?: string | null;
  }): Promise<void> {
    const existing = await this.getTriggerState(
      input.automationId,
      input.stateKey,
    );
    const updatedAt = new Date().toISOString();

    if (existing) {
      const values: Record<string, unknown> = { updatedAt };
      if (input.breachStartedAt !== undefined)
        values.breachStartedAt = input.breachStartedAt;
      if (input.lastFiredAt !== undefined)
        values.lastFiredAt = input.lastFiredAt;
      if (input.lastValue !== undefined) values.lastValue = input.lastValue;
      if (input.lastObservedState !== undefined)
        values.lastObservedState = input.lastObservedState;

      await this.context.drizzle
        .update(automationTriggerState)
        .set(values)
        .where(
          and(
            eq(automationTriggerState.automationId, input.automationId),
            eq(automationTriggerState.stateKey, input.stateKey),
          ),
        );
    } else {
      await this.context.drizzle.insert(automationTriggerState).values({
        automationId: input.automationId,
        stateKey: input.stateKey,
        breachStartedAt: input.breachStartedAt ?? null,
        lastFiredAt: input.lastFiredAt ?? null,
        lastValue: input.lastValue ?? null,
        lastObservedState: input.lastObservedState ?? null,
        updatedAt,
      });
    }
    await this.afterWrite();
  }

  async clearBreach(automationId: number, stateKey: string): Promise<void> {
    await this.context.drizzle
      .update(automationTriggerState)
      .set({ breachStartedAt: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(automationTriggerState.automationId, automationId),
          eq(automationTriggerState.stateKey, stateKey),
        ),
      );
    await this.afterWrite();
  }

  /** Dwell windows the scheduler has to re-check without a fresh sample. */
  async listOpenBreaches(): Promise<TriggerStateRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(automationTriggerState)
      .where(sql`${automationTriggerState.breachStartedAt} IS NOT NULL`);
    return rows.map(mapTriggerStateRow);
  }

  // --- schedules ---

  async upsertSchedule(input: {
    automationId: number;
    cron: string | null;
    intervalSeconds: number | null;
    timezone: string | null;
    nextDueAt: string | null;
  }): Promise<void> {
    const existing = await this.context.drizzle
      .select({ id: automationSchedules.id })
      .from(automationSchedules)
      .where(eq(automationSchedules.automationId, input.automationId))
      .limit(1);

    if (existing[0]) {
      await this.context.drizzle
        .update(automationSchedules)
        .set({
          cron: input.cron,
          intervalSeconds: input.intervalSeconds,
          timezone: input.timezone,
          nextDueAt: input.nextDueAt,
        })
        .where(eq(automationSchedules.automationId, input.automationId));
    } else {
      await this.context.drizzle.insert(automationSchedules).values(input);
    }
    await this.afterWrite();
  }

  async deleteSchedule(automationId: number): Promise<void> {
    await this.context.drizzle
      .delete(automationSchedules)
      .where(eq(automationSchedules.automationId, automationId));
    await this.afterWrite();
  }

  /** Schedules due at or before `now`, joined to their enabled automation. */
  async listDueSchedules(now: string): Promise<DueScheduleRow[]> {
    const rows = await this.context.drizzle
      .select({
        automationId: automationSchedules.automationId,
        cron: automationSchedules.cron,
        intervalSeconds: automationSchedules.intervalSeconds,
        timezone: automationSchedules.timezone,
        nextDueAt: automationSchedules.nextDueAt,
      })
      .from(automationSchedules)
      .innerJoin(
        automations,
        eq(automations.id, automationSchedules.automationId),
      )
      .where(
        and(
          eq(automations.enabled, true),
          lte(automationSchedules.nextDueAt, now),
        ),
      );
    return rows;
  }

  async markScheduleTicked(
    automationId: number,
    nextDueAt: string | null,
    lastTickAt: string,
  ): Promise<void> {
    await this.context.drizzle
      .update(automationSchedules)
      .set({ nextDueAt, lastTickAt })
      .where(eq(automationSchedules.automationId, automationId));
    await this.afterWrite();
  }

  // --- runs ---

  async createRun(input: {
    automationId: number;
    userId: string;
    triggerType: string;
    triggerContext?: string | null;
    status: string;
    dryRun?: boolean;
    parentRunId?: number | null;
    now?: string;
  }): Promise<AutomationRunRow> {
    const [created] = await insertReturning(this.context, automationRuns, {
      automationId: input.automationId,
      userId: input.userId,
      triggerType: input.triggerType,
      triggerContext: input.triggerContext ?? null,
      status: input.status,
      startedAt: input.now ?? new Date().toISOString(),
      dryRun: input.dryRun ?? false,
      parentRunId: input.parentRunId ?? null,
    });
    await this.afterWrite();
    return mapRunRow(created);
  }

  async finishRun(
    runId: number,
    input: {
      status: string;
      error?: string | null;
      finishedAt?: string;
      durationMs?: number | null;
    },
  ): Promise<void> {
    const finishedAt = input.finishedAt ?? new Date().toISOString();
    await this.context.drizzle
      .update(automationRuns)
      .set({
        status: input.status,
        error: input.error ?? null,
        finishedAt,
        durationMs: input.durationMs ?? null,
      })
      .where(eq(automationRuns.id, runId));

    const run = await this.context.drizzle
      .select({
        automationId: automationRuns.automationId,
        startedAt: automationRuns.startedAt,
      })
      .from(automationRuns)
      .where(eq(automationRuns.id, runId))
      .limit(1);

    if (run[0]) {
      await this.context.drizzle
        .update(automations)
        .set({ lastRunAt: run[0].startedAt, lastRunStatus: input.status })
        .where(eq(automations.id, run[0].automationId));
    }
    await this.afterWrite();
  }

  async listRuns(
    userId: string,
    options: { automationId?: number; limit?: number; offset?: number } = {},
  ): Promise<AutomationRunRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const where = options.automationId
      ? and(
          eq(automationRuns.userId, userId),
          eq(automationRuns.automationId, options.automationId),
        )
      : eq(automationRuns.userId, userId);

    const rows = await this.context.drizzle
      .select({
        run: automationRuns,
        automationName: automations.name,
      })
      .from(automationRuns)
      .leftJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(where)
      .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      ...mapRunRow(row.run),
      automation_name: row.automationName ?? null,
    }));
  }

  async findRunForUser(
    runId: number,
    userId: string,
  ): Promise<AutomationRunRow | null> {
    const rows = await this.context.drizzle
      .select()
      .from(automationRuns)
      .where(
        and(eq(automationRuns.id, runId), eq(automationRuns.userId, userId)),
      )
      .limit(1);
    return rows[0] ? mapRunRow(rows[0]) : null;
  }

  async countRunningFor(automationId: number): Promise<number> {
    const rows = await this.context.drizzle
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, automationId),
          eq(automationRuns.status, "running"),
        ),
      );
    return rows.length;
  }

  // --- run steps ---

  async createRunStep(input: {
    runId: number;
    stepIndex: number;
    stepId: string;
    stepType: string;
    status: string;
    now?: string;
  }): Promise<number> {
    const [created] = await insertReturning(this.context, automationRunSteps, {
      runId: input.runId,
      stepIndex: input.stepIndex,
      stepId: input.stepId,
      stepType: input.stepType,
      status: input.status,
      startedAt: input.now ?? new Date().toISOString(),
    });
    await this.afterWrite();
    return created.id;
  }

  async finishRunStep(
    stepRowId: number,
    input: {
      status: string;
      output?: string | null;
      error?: string | null;
      truncated?: boolean;
      finishedAt?: string;
    },
  ): Promise<void> {
    await this.context.drizzle
      .update(automationRunSteps)
      .set({
        status: input.status,
        output: input.output ?? null,
        error: input.error ?? null,
        truncated: input.truncated ?? false,
        finishedAt: input.finishedAt ?? new Date().toISOString(),
      })
      .where(eq(automationRunSteps.id, stepRowId));
    await this.afterWrite();
  }

  async listRunSteps(runId: number): Promise<AutomationRunStepRow[]> {
    const rows = await this.context.drizzle
      .select()
      .from(automationRunSteps)
      .where(eq(automationRunSteps.runId, runId))
      .orderBy(asc(automationRunSteps.stepIndex));
    return rows.map(mapRunStepRow);
  }

  /**
   * Trims run history. Called from the scheduler's daily sweep rather than on
   * every write, which is what made the alert engine's pruning expensive.
   */
  async pruneRunsOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const result = await this.context.drizzle
      .delete(automationRuns)
      .where(lt(automationRuns.startedAt, cutoff));
    const deleted = rowsAffected(result);
    if (deleted > 0) await this.afterWrite();
    return deleted;
  }

  /** Marks runs left behind by a crash so they do not block concurrency. */
  async failStaleRunningRuns(olderThanIso: string): Promise<number> {
    const result = await this.context.drizzle
      .update(automationRuns)
      .set({
        status: "failed",
        error: "Interrupted by a server restart",
        finishedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(automationRuns.status, "running"),
          lt(automationRuns.startedAt, olderThanIso),
        ),
      );
    const affected = rowsAffected(result);
    if (affected > 0) await this.afterWrite();
    return affected;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(automations)
      .where(eq(automations.userId, userId));
    const deleted = rowsAffected(result);
    if (deleted > 0) await this.afterWrite();
    return deleted;
  }

  private async listChannelIds(automationId: number): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ channelId: automationChannels.channelId })
      .from(automationChannels)
      .where(eq(automationChannels.automationId, automationId));
    return rows.map((row) => row.channelId);
  }

  private async replaceChannels(
    automationId: number,
    userId: string,
    channelIds: number[],
  ): Promise<number[]> {
    await this.context.drizzle
      .delete(automationChannels)
      .where(eq(automationChannels.automationId, automationId));

    if (channelIds.length === 0) return [];

    // One lookup for the whole set instead of a query per channel.
    const owned = await this.context.drizzle
      .select({ id: notificationChannels.id })
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, userId),
          inArray(notificationChannels.id, channelIds),
        ),
      );

    const linked = owned.map((row) => row.id);
    if (linked.length > 0) {
      await this.context.drizzle
        .insert(automationChannels)
        .values(linked.map((channelId) => ({ automationId, channelId })));
    }
    return linked;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}

function mapAutomationRow(
  row: AutomationRecord,
  channels: number[] = [],
): AutomationRow {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    description: row.description ?? null,
    enabled: row.enabled ? 1 : 0,
    definition: row.definition,
    definition_version: row.definitionVersion,
    concurrency_policy: row.concurrencyPolicy,
    max_run_seconds: row.maxRunSeconds,
    dry_run: row.dryRun ? 1 : 0,
    last_run_at: row.lastRunAt ?? null,
    last_run_status: row.lastRunStatus ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    channels,
  };
}

function mapEngineRow(row: AutomationRecord): AutomationEngineRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    enabled: !!row.enabled,
    definition: row.definition,
    concurrencyPolicy: row.concurrencyPolicy,
    maxRunSeconds: row.maxRunSeconds,
    dryRun: !!row.dryRun,
  };
}

function mapTriggerStateRow(row: TriggerStateRecord): TriggerStateRow {
  return {
    automationId: row.automationId,
    stateKey: row.stateKey,
    breachStartedAt: row.breachStartedAt ?? null,
    lastFiredAt: row.lastFiredAt ?? null,
    lastValue: row.lastValue ?? null,
    lastObservedState: row.lastObservedState ?? null,
  };
}

function mapRunRow(row: AutomationRunRecord): AutomationRunRow {
  return {
    id: row.id,
    automation_id: row.automationId,
    user_id: row.userId,
    trigger_type: row.triggerType,
    trigger_context: row.triggerContext ?? null,
    status: row.status,
    started_at: row.startedAt,
    finished_at: row.finishedAt ?? null,
    duration_ms: row.durationMs ?? null,
    error: row.error ?? null,
    dry_run: row.dryRun ? 1 : 0,
    parent_run_id: row.parentRunId ?? null,
  };
}

function mapRunStepRow(row: AutomationRunStepRecord): AutomationRunStepRow {
  return {
    id: row.id,
    run_id: row.runId,
    step_index: row.stepIndex,
    step_id: row.stepId,
    step_type: row.stepType,
    status: row.status,
    started_at: row.startedAt,
    finished_at: row.finishedAt ?? null,
    output: row.output ?? null,
    error: row.error ?? null,
    truncated: row.truncated ? 1 : 0,
  };
}
