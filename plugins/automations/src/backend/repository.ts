import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";
import {
  automations as automationsDef,
  channels as channelsDef,
  runSteps as runStepsDef,
  runs as runsDef,
  schedules as schedulesDef,
  triggerState as triggerStateDef,
} from "./tables.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped, and the
// drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

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

/** The shape the engine loads. */
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

export type AutomationRepository = Awaited<
  ReturnType<typeof createAutomationRepository>
>;

/**
 * Automation storage. `ownedChannelIds` answers which alert
 * channels the user owns, so a link can never point at another user's.
 */
export async function createAutomationRepository(
  db: PluginDatabase,
  ownedChannelIds: (userId: string) => Promise<number[]>,
) {
  const automations: Table = await db.define(automationsDef);
  const triggerState: Table = await db.define(triggerStateDef);
  const schedules: Table = await db.define(schedulesDef);
  const runs: Table = await db.define(runsDef);
  const runSteps: Table = await db.define(runStepsDef);
  const channels: Table = await db.define(channelsDef);

  const client = () => db.client<Drizzle>();

  /** Inserts one row and returns its id. MySQL has no RETURNING. */
  async function insertId(
    table: Table,
    values: Record<string, unknown>,
  ): Promise<number> {
    const drizzle = await client();
    if (db.dialect === "mysql") {
      const result = await drizzle.insert(table).values(values);
      const header = Array.isArray(result) ? result[0] : result;
      return Number(header?.insertId);
    }
    const rows = await drizzle
      .insert(table)
      .values(values)
      .returning({ id: table.id });
    return rows[0].id as number;
  }

  async function listChannelIds(automationId: number): Promise<number[]> {
    const drizzle = await client();
    const rows: Row[] = await drizzle
      .select({ channelId: channels.channelId })
      .from(channels)
      .where(eq(channels.automationId, automationId));
    return rows.map((row) => row.channelId as number);
  }

  async function replaceChannels(
    automationId: number,
    userId: string,
    channelIds: number[],
  ): Promise<void> {
    const drizzle = await client();
    await drizzle
      .delete(channels)
      .where(eq(channels.automationId, automationId));
    if (channelIds.length === 0) return;

    const owned = new Set(await ownedChannelIds(userId));
    const linked = [...new Set(channelIds)].filter((id) => owned.has(id));
    if (linked.length > 0) {
      await drizzle
        .insert(channels)
        .values(linked.map((channelId) => ({ automationId, channelId })));
    }
  }

  async function findForUser(
    id: number,
    userId: string,
  ): Promise<AutomationRow | null> {
    const drizzle = await client();
    const rows: Row[] = await drizzle
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.userId, userId)))
      .limit(1);
    if (!rows[0]) return null;
    return mapAutomationRow(rows[0], await listChannelIds(id));
  }

  async function getTriggerState(
    automationId: number,
    stateKey: string,
  ): Promise<TriggerStateRow | null> {
    const drizzle = await client();
    const rows: Row[] = await drizzle
      .select()
      .from(triggerState)
      .where(
        and(
          eq(triggerState.automationId, automationId),
          eq(triggerState.stateKey, stateKey),
        ),
      )
      .limit(1);
    return rows[0] ? mapTriggerStateRow(rows[0]) : null;
  }

  return {
    async list(userId: string): Promise<AutomationRow[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(automations)
        .where(eq(automations.userId, userId))
        .orderBy(asc(automations.name));
      if (rows.length === 0) return [];

      // One query for every automation's channels rather than one per row.
      const links: Row[] = await drizzle
        .select({
          automationId: channels.automationId,
          channelId: channels.channelId,
        })
        .from(channels)
        .where(
          inArray(
            channels.automationId,
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
    },

    findForUser,

    async findById(id: number): Promise<AutomationEngineRow | null> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(automations)
        .where(eq(automations.id, id))
        .limit(1);
      return rows[0] ? mapEngineRow(rows[0]) : null;
    },

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
    }): Promise<AutomationRow> {
      const now = new Date().toISOString();
      const id = await insertId(automations, {
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
      await replaceChannels(id, input.userId, input.channels ?? []);
      await db.persist();
      const created = await findForUser(id, input.userId);
      if (!created) throw new Error("Automation could not be read back");
      return created;
    },

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
      },
    ): Promise<AutomationRow | null> {
      const existing = await findForUser(id, userId);
      if (!existing) return null;

      const { channels: channelIds, ...fields } = input;
      const drizzle = await client();
      if (Object.keys(fields).length > 0) {
        await drizzle
          .update(automations)
          .set({ ...fields, updatedAt: new Date().toISOString() })
          .where(and(eq(automations.id, id), eq(automations.userId, userId)));
      }
      if (channelIds) await replaceChannels(id, userId, channelIds);
      await db.persist();
      return findForUser(id, userId);
    },

    async delete(id: number, userId: string): Promise<boolean> {
      const existing = await findForUser(id, userId);
      if (!existing) return false;
      const drizzle = await client();
      await drizzle
        .delete(automations)
        .where(and(eq(automations.id, id), eq(automations.userId, userId)));
      await db.persist();
      return true;
    },

    /**
     * Enabled automations owned by one user. Wildcard targets must never
     * reach across users.
     */
    async listEnabledForUser(userId: string): Promise<AutomationEngineRow[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(automations)
        .where(
          and(eq(automations.enabled, true), eq(automations.userId, userId)),
        );
      return rows.map(mapEngineRow);
    },

    async listAllEnabled(): Promise<AutomationEngineRow[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(automations)
        .where(eq(automations.enabled, true));
      return rows.map(mapEngineRow);
    },

    getTriggerState,

    async upsertTriggerState(input: {
      automationId: number;
      stateKey: string;
      breachStartedAt?: string | null;
      lastFiredAt?: string | null;
      lastValue?: number | null;
      lastObservedState?: string | null;
    }): Promise<void> {
      const existing = await getTriggerState(
        input.automationId,
        input.stateKey,
      );
      const updatedAt = new Date().toISOString();
      const drizzle = await client();

      if (existing) {
        const values: Record<string, unknown> = { updatedAt };
        if (input.breachStartedAt !== undefined)
          values.breachStartedAt = input.breachStartedAt;
        if (input.lastFiredAt !== undefined)
          values.lastFiredAt = input.lastFiredAt;
        if (input.lastValue !== undefined) values.lastValue = input.lastValue;
        if (input.lastObservedState !== undefined)
          values.lastObservedState = input.lastObservedState;
        await drizzle
          .update(triggerState)
          .set(values)
          .where(
            and(
              eq(triggerState.automationId, input.automationId),
              eq(triggerState.stateKey, input.stateKey),
            ),
          );
      } else {
        await drizzle.insert(triggerState).values({
          automationId: input.automationId,
          stateKey: input.stateKey,
          breachStartedAt: input.breachStartedAt ?? null,
          lastFiredAt: input.lastFiredAt ?? null,
          lastValue: input.lastValue ?? null,
          lastObservedState: input.lastObservedState ?? null,
          updatedAt,
        });
      }
      await db.persist({ lazy: true });
    },

    async clearBreach(automationId: number, stateKey: string): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(triggerState)
        .set({ breachStartedAt: null, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(triggerState.automationId, automationId),
            eq(triggerState.stateKey, stateKey),
          ),
        );
      await db.persist({ lazy: true });
    },

    /** Dwell windows the scheduler has to re-check without a fresh sample. */
    async listOpenBreaches(): Promise<TriggerStateRow[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(triggerState)
        .where(sql`${triggerState.breachStartedAt} IS NOT NULL`);
      return rows.map(mapTriggerStateRow);
    },

    async upsertSchedule(input: {
      automationId: number;
      cron: string | null;
      intervalSeconds: number | null;
      timezone: string | null;
      nextDueAt: string | null;
    }): Promise<void> {
      const drizzle = await client();
      const existing: Row[] = await drizzle
        .select({ id: schedules.id })
        .from(schedules)
        .where(eq(schedules.automationId, input.automationId))
        .limit(1);
      if (existing[0]) {
        await drizzle
          .update(schedules)
          .set({
            cron: input.cron,
            intervalSeconds: input.intervalSeconds,
            timezone: input.timezone,
            nextDueAt: input.nextDueAt,
          })
          .where(eq(schedules.automationId, input.automationId));
      } else {
        await drizzle.insert(schedules).values(input);
      }
      await db.persist();
    },

    async deleteSchedule(automationId: number): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(schedules)
        .where(eq(schedules.automationId, automationId));
      await db.persist();
    },

    /** Schedules due at or before `now`, joined to their enabled automation. */
    async listDueSchedules(now: string): Promise<DueScheduleRow[]> {
      const drizzle = await client();
      return drizzle
        .select({
          automationId: schedules.automationId,
          cron: schedules.cron,
          intervalSeconds: schedules.intervalSeconds,
          timezone: schedules.timezone,
          nextDueAt: schedules.nextDueAt,
        })
        .from(schedules)
        .innerJoin(automations, eq(automations.id, schedules.automationId))
        .where(
          and(eq(automations.enabled, true), lte(schedules.nextDueAt, now)),
        );
    },

    async markScheduleTicked(
      automationId: number,
      nextDueAt: string | null,
      lastTickAt: string,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(schedules)
        .set({ nextDueAt, lastTickAt })
        .where(eq(schedules.automationId, automationId));
      await db.persist({ lazy: true });
    },

    async createRun(input: {
      automationId: number;
      userId: string;
      triggerType: string;
      triggerContext?: string | null;
      status: string;
      dryRun?: boolean;
      parentRunId?: number | null;
    }): Promise<{ id: number }> {
      const id = await insertId(runs, {
        automationId: input.automationId,
        userId: input.userId,
        triggerType: input.triggerType,
        triggerContext: input.triggerContext ?? null,
        status: input.status,
        startedAt: new Date().toISOString(),
        dryRun: input.dryRun ?? false,
        parentRunId: input.parentRunId ?? null,
      });
      await db.persist({ lazy: true });
      return { id };
    },

    async finishRun(
      runId: number,
      input: {
        status: string;
        error?: string | null;
        durationMs?: number | null;
      },
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(runs)
        .set({
          status: input.status,
          error: input.error ?? null,
          finishedAt: new Date().toISOString(),
          durationMs: input.durationMs ?? null,
        })
        .where(eq(runs.id, runId));

      const run: Row[] = await drizzle
        .select({ automationId: runs.automationId, startedAt: runs.startedAt })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      if (run[0]) {
        await drizzle
          .update(automations)
          .set({ lastRunAt: run[0].startedAt, lastRunStatus: input.status })
          .where(eq(automations.id, run[0].automationId));
      }
      await db.persist();
    },

    async listRuns(
      userId: string,
      options: { automationId?: number; limit?: number; offset?: number } = {},
    ): Promise<AutomationRunRow[]> {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const offset = Math.max(options.offset ?? 0, 0);
      const where = options.automationId
        ? and(
            eq(runs.userId, userId),
            eq(runs.automationId, options.automationId),
          )
        : eq(runs.userId, userId);

      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select({ run: runs, automationName: automations.name })
        .from(runs)
        .leftJoin(automations, eq(automations.id, runs.automationId))
        .where(where)
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        ...mapRunRow(row.run),
        automation_name: row.automationName ?? null,
      }));
    },

    async findRunForUser(
      runId: number,
      userId: string,
    ): Promise<AutomationRunRow | null> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
        .limit(1);
      return rows[0] ? mapRunRow(rows[0]) : null;
    },

    async createRunStep(input: {
      runId: number;
      stepIndex: number;
      stepId: string;
      stepType: string;
      status: string;
    }): Promise<number> {
      const id = await insertId(runSteps, {
        ...input,
        startedAt: new Date().toISOString(),
      });
      await db.persist({ lazy: true });
      return id;
    },

    async finishRunStep(
      stepRowId: number,
      input: {
        status: string;
        output?: string | null;
        error?: string | null;
        truncated?: boolean;
      },
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(runSteps)
        .set({
          status: input.status,
          output: input.output ?? null,
          error: input.error ?? null,
          truncated: input.truncated ?? false,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(runSteps.id, stepRowId));
      await db.persist({ lazy: true });
    },

    async listRunSteps(runId: number): Promise<AutomationRunStepRow[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.stepIndex));
      return rows.map(mapRunStepRow);
    },

    /** Trims run history. Called from the scheduler's daily sweep. */
    async pruneRunsOlderThan(days: number): Promise<number> {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const drizzle = await client();
      const old: Row[] = await drizzle
        .select({ id: runs.id })
        .from(runs)
        .where(lt(runs.startedAt, cutoff));
      if (old.length === 0) return 0;
      await drizzle.delete(runs).where(lt(runs.startedAt, cutoff));
      await db.persist();
      return old.length;
    },

    /** Marks runs left behind by a crash so they do not block concurrency. */
    async failStaleRunningRuns(olderThanIso: string): Promise<number> {
      const where = and(
        eq(runs.status, "running"),
        lt(runs.startedAt, olderThanIso),
      );
      const drizzle = await client();
      const stale: Row[] = await drizzle
        .select({ id: runs.id })
        .from(runs)
        .where(where);
      if (stale.length === 0) return 0;
      await drizzle
        .update(runs)
        .set({
          status: "failed",
          error: "Interrupted by a server restart",
          finishedAt: new Date().toISOString(),
        })
        .where(where);
      await db.persist();
      return stale.length;
    },
  };
}

function mapAutomationRow(row: Row, channelIds: number[] = []): AutomationRow {
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
    channels: channelIds,
  };
}

function mapEngineRow(row: Row): AutomationEngineRow {
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

function mapTriggerStateRow(row: Row): TriggerStateRow {
  return {
    automationId: row.automationId,
    stateKey: row.stateKey,
    breachStartedAt: row.breachStartedAt ?? null,
    lastFiredAt: row.lastFiredAt ?? null,
    lastValue: row.lastValue ?? null,
    lastObservedState: row.lastObservedState ?? null,
  };
}

function mapRunRow(row: Row): AutomationRunRow {
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

function mapRunStepRow(row: Row): AutomationRunStepRow {
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
