import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { agentEvents, agentQueue, agentSessions } from "../tables.js";
import type { AgentEvent, AgentSession } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Events kept per session; older ones are pruned as new ones land. */
export const EVENT_HISTORY = 2000;

type SessionRow = {
  sessionId: string;
  userId: string;
  hostId: number;
  providerId: number;
  agent: AgentSession["agent"];
  model: string;
  cwd: string;
  executable: string;
  nativeId: string | null;
  title: string | null;
  archived: boolean;
  queuePaused: boolean;
  draft: string | null;
  attachments: string;
  updatedAt: string;
};

function toRow(s: AgentSession): SessionRow {
  return {
    sessionId: s.id,
    userId: s.userId,
    hostId: s.hostId,
    providerId: s.providerId,
    agent: s.agent,
    model: s.model,
    cwd: s.cwd,
    executable: s.executable,
    nativeId: s.nativeId ?? null,
    title: s.title ?? null,
    archived: !!s.archived,
    queuePaused: !!s.queuePaused,
    draft: s.draft ?? null,
    attachments: JSON.stringify(s.attachments ?? []),
    updatedAt: s.updatedAt,
  };
}

function fromRow(row: SessionRow): AgentSession {
  return {
    id: row.sessionId,
    userId: row.userId,
    hostId: Number(row.hostId),
    providerId: Number(row.providerId),
    agent: row.agent,
    model: row.model,
    cwd: row.cwd,
    executable: row.executable,
    nativeId: row.nativeId ?? undefined,
    title: row.title ?? undefined,
    archived: !!row.archived,
    queuePaused: !!row.queuePaused,
    draft: row.draft ?? undefined,
    attachments: JSON.parse(row.attachments),
    status: "stopped",
    events: [],
    updatedAt: row.updatedAt,
  };
}

/**
 * Agent sessions in the plugin's own tables. A session row holds what the
 * user configured; events and queued prompts are separate rows, so a long run
 * appends a few rows a second instead of rewriting everything it said.
 */
export async function createAgentStore(ctx: Pick<PluginContext, "db">) {
  const { db } = ctx;
  const sessions: Table = await db.define(agentSessions);
  const events: Table = await db.define(agentEvents);
  const queue: Table = await db.define(agentQueue);
  const client = () => db.client<Drizzle>();

  async function writeSession(d: Drizzle, s: AgentSession) {
    const row = toRow(s);
    const where = eq(sessions.sessionId, s.id);
    const existing = await d.select().from(sessions).where(where).limit(1);
    if (existing.length) await d.update(sessions).set(row).where(where);
    else await d.insert(sessions).values(row);
  }

  return {
    async list(userId: string): Promise<AgentSession[]> {
      const rows = await (
        await client()
      )
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      return rows.map(fromRow);
    },

    /** The session without its events, which only the event stream needs. */
    async get(userId: string, id: string): Promise<AgentSession | null> {
      const d = await client();
      const [row] = await d
        .select()
        .from(sessions)
        .where(and(eq(sessions.sessionId, id), eq(sessions.userId, userId)))
        .limit(1);
      if (!row) return null;
      const s = fromRow(row);
      const prompts = await d
        .select()
        .from(queue)
        .where(eq(queue.sessionId, id))
        .orderBy(asc(queue.position));
      if (prompts.length)
        s.queue = prompts.map(
          (p: { promptId: string; text: string; attachmentIds: string }) => ({
            id: p.promptId,
            text: p.text,
            attachmentIds: JSON.parse(p.attachmentIds),
          }),
        );
      return s;
    },

    async events(id: string, after = 0): Promise<AgentEvent[]> {
      const rows = await (
        await client()
      )
        .select()
        .from(events)
        .where(and(eq(events.sessionId, id), gt(events.seq, after)))
        .orderBy(desc(events.seq))
        .limit(EVENT_HISTORY);
      return rows
        .reverse()
        .map(
          (e: {
            seq: number;
            kind: AgentEvent["kind"];
            text: string;
            requestId: string | null;
            choices: string | null;
          }) => ({
            seq: Number(e.seq),
            kind: e.kind,
            text: e.text,
            ...(e.requestId ? { requestId: e.requestId } : {}),
            ...(e.choices ? { choices: JSON.parse(e.choices) } : {}),
          }),
        );
    },

    /** Session fields and queue. Durable before it resolves. */
    async save(s: AgentSession): Promise<void> {
      const d = await client();
      await writeSession(d, s);
      await d.delete(queue).where(eq(queue.sessionId, s.id));
      const prompts = s.queue ?? [];
      if (prompts.length)
        await d.insert(queue).values(
          prompts.map((p, position) => ({
            sessionId: s.id,
            userId: s.userId,
            promptId: p.id,
            position,
            text: p.text,
            attachmentIds: JSON.stringify(p.attachmentIds),
          })),
        );
      await db.persist();
    },

    /**
     * Session fields plus new events. Informational, so it joins the next
     * periodic save rather than forcing one per batch.
     */
    async append(s: AgentSession, batch: AgentEvent[]): Promise<void> {
      if (!batch.length) return;
      const d = await client();
      const lastSeq = batch[batch.length - 1].seq;
      await d.insert(events).values(
        batch.map((e) => ({
          sessionId: s.id,
          userId: s.userId,
          seq: e.seq,
          kind: e.kind,
          text: e.text,
          requestId: e.requestId ?? null,
          choices: e.choices ? JSON.stringify(e.choices) : null,
        })),
      );
      await d
        .delete(events)
        .where(
          and(
            eq(events.sessionId, s.id),
            lte(events.seq, lastSeq - EVENT_HISTORY),
          ),
        );
      await writeSession(d, s);
      await db.persist({ lazy: true });
    },

    async delete(id: string): Promise<void> {
      const d = await client();
      await d.delete(events).where(eq(events.sessionId, id));
      await d.delete(queue).where(eq(queue.sessionId, id));
      await d.delete(sessions).where(eq(sessions.sessionId, id));
      await db.persist();
    },
  };
}

export type AgentStore = Awaited<ReturnType<typeof createAgentStore>>;
