import { and, desc, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  conversations as conversationsDef,
  messages as messagesDef,
  proposals as proposalsDef,
  providers as providersDef,
} from "./tables.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface AiProviderRecord {
  id: number;
  userId: string;
  providerType: string;
  label: string;
  baseUrl: string | null;
  apiKeyPrefix: string | null;
  defaultModel: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A provider with its key, for the one path that makes outbound calls. */
export interface AiProviderWithSecret extends AiProviderRecord {
  apiKey: string | null;
}

export interface AiConversationRecord {
  id: number;
  userId: string;
  title: string | null;
  providerId: number | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRecord {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  toolCalls: string | null;
  createdAt: string;
}

export interface AiProposalRecord {
  id: number;
  conversationId: number;
  userId: string;
  kind: string;
  summary: string | null;
  payload: string;
  status: string;
  appliedAt: string | null;
  resultSummary: string | null;
  createdAt: string;
}

export interface AiProviderInput {
  providerType: string;
  label: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  defaultModel?: string | null;
  enabled?: boolean;
}

/** Where a provider's key lives in ctx.secrets. */
export function providerSecretKey(providerId: number): string {
  return `provider:${providerId}`;
}

/**
 * Keeps the first few characters so the UI can tell two keys apart without
 * ever receiving the key itself.
 */
export function apiKeyPrefix(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  return apiKey.slice(0, 6);
}

const now = () => new Date().toISOString();

export type AiRepository = Awaited<ReturnType<typeof createAiRepository>>;

/**
 * The assistant's rows. Every method takes the owning user and scopes to
 * them. Keys go through ctx.secrets, which is per acting user, so key reads
 * and writes run inside the request (or ctx.asUser) of that same user.
 */
export async function createAiRepository(
  ctx: Pick<PluginContext, "db" | "secrets">,
) {
  const { db, secrets } = ctx;
  const providers: Table = await db.define(providersDef);
  const conversations: Table = await db.define(conversationsDef);
  const messages: Table = await db.define(messagesDef);
  const proposals: Table = await db.define(proposalsDef);

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

  async function first<T>(table: Table, where: unknown): Promise<T | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(table)
      .where(where)
      .limit(1);
    return (rows[0] as T) ?? null;
  }

  const repo = {
    // --- providers ---

    /** Never includes key material; callers get the masked prefix only. */
    async listProviders(userId: string): Promise<AiProviderRecord[]> {
      return (await client())
        .select()
        .from(providers)
        .where(eq(providers.userId, userId))
        .orderBy(providers.id);
    },

    async findProvider(
      id: number,
      userId: string,
    ): Promise<AiProviderRecord | null> {
      return first<AiProviderRecord>(
        providers,
        and(eq(providers.id, id), eq(providers.userId, userId)),
      );
    },

    /**
     * The one path that returns usable key material, right before an
     * outbound request. Must run as `userId`.
     */
    async findProviderWithSecret(
      id: number,
      userId: string,
    ): Promise<AiProviderWithSecret | null> {
      const row = await repo.findProvider(id, userId);
      if (!row) return null;
      return { ...row, apiKey: await secrets.get(providerSecretKey(id)) };
    },

    async createProvider(
      userId: string,
      input: AiProviderInput,
    ): Promise<AiProviderRecord> {
      const stamp = now();
      const id = await insertId(providers, {
        userId,
        providerType: input.providerType,
        label: input.label,
        baseUrl: input.baseUrl ?? null,
        apiKeyPrefix: apiKeyPrefix(input.apiKey),
        defaultModel: input.defaultModel ?? null,
        enabled: input.enabled ?? true,
        createdAt: stamp,
        updatedAt: stamp,
      });
      if (input.apiKey) {
        await secrets.set(providerSecretKey(id), input.apiKey);
      }
      await db.persist();
      const created = await repo.findProvider(id, userId);
      if (!created) throw new Error("Provider could not be read back");
      return created;
    },

    async updateProvider(
      id: number,
      userId: string,
      input: Partial<AiProviderInput>,
    ): Promise<AiProviderRecord | null> {
      const existing = await repo.findProvider(id, userId);
      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: now() };
      if (input.providerType !== undefined)
        updates.providerType = input.providerType;
      if (input.label !== undefined) updates.label = input.label;
      if (input.baseUrl !== undefined) updates.baseUrl = input.baseUrl;
      if (input.defaultModel !== undefined)
        updates.defaultModel = input.defaultModel;
      if (input.enabled !== undefined) updates.enabled = input.enabled;

      // An empty string clears the key; undefined leaves it untouched.
      if (input.apiKey !== undefined) {
        updates.apiKeyPrefix = apiKeyPrefix(input.apiKey);
        await secrets.set(providerSecretKey(id), input.apiKey || null);
      }

      await (
        await client()
      )
        .update(providers)
        .set(updates)
        .where(and(eq(providers.id, id), eq(providers.userId, userId)));
      await db.persist();
      return repo.findProvider(id, userId);
    },

    async deleteProvider(id: number, userId: string): Promise<boolean> {
      const existing = await repo.findProvider(id, userId);
      if (!existing) return false;
      await (
        await client()
      )
        .delete(providers)
        .where(and(eq(providers.id, id), eq(providers.userId, userId)));
      await secrets.delete(providerSecretKey(id));
      await db.persist();
      return true;
    },

    // --- conversations ---

    async listConversations(
      userId: string,
      limit = 50,
    ): Promise<AiConversationRecord[]> {
      return (await client())
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit);
    },

    async findConversation(
      id: number,
      userId: string,
    ): Promise<AiConversationRecord | null> {
      return first<AiConversationRecord>(
        conversations,
        and(eq(conversations.id, id), eq(conversations.userId, userId)),
      );
    },

    async createConversation(input: {
      userId: string;
      title?: string | null;
      providerId?: number | null;
      model?: string | null;
    }): Promise<AiConversationRecord> {
      const stamp = now();
      const id = await insertId(conversations, {
        userId: input.userId,
        title: input.title ?? null,
        providerId: input.providerId ?? null,
        model: input.model ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      });
      await db.persist();
      const created = await repo.findConversation(id, input.userId);
      if (!created) throw new Error("Conversation could not be read back");
      return created;
    },

    async touchConversation(id: number): Promise<void> {
      await (
        await client()
      )
        .update(conversations)
        .set({ updatedAt: now() })
        .where(eq(conversations.id, id));
      await db.persist();
    },

    async deleteConversation(id: number, userId: string): Promise<boolean> {
      const existing = await repo.findConversation(id, userId);
      if (!existing) return false;
      // Deleted explicitly rather than trusting the cascade, which a
      // connection without foreign keys on would skip.
      const drizzle = await client();
      await drizzle.delete(messages).where(eq(messages.conversationId, id));
      await drizzle.delete(proposals).where(eq(proposals.conversationId, id));
      await drizzle
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
      await db.persist();
      return true;
    },

    // --- messages ---

    async listMessages(conversationId: number): Promise<AiMessageRecord[]> {
      return (await client())
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.id);
    },

    async appendMessage(input: {
      conversationId: number;
      role: string;
      content: string;
      toolCalls?: string | null;
    }): Promise<void> {
      await insertId(messages, {
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        toolCalls: input.toolCalls ?? null,
        createdAt: now(),
      });
      await db.persist();
    },

    // --- proposals ---

    async listProposals(
      userId: string,
      conversationId: number,
    ): Promise<AiProposalRecord[]> {
      return (await client())
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.userId, userId),
            eq(proposals.conversationId, conversationId),
          ),
        )
        .orderBy(desc(proposals.id));
    },

    async findProposal(
      id: number,
      userId: string,
    ): Promise<AiProposalRecord | null> {
      return first<AiProposalRecord>(
        proposals,
        and(eq(proposals.id, id), eq(proposals.userId, userId)),
      );
    },

    async createProposal(input: {
      conversationId: number;
      userId: string;
      kind: string;
      summary?: string | null;
      payload: string;
    }): Promise<AiProposalRecord> {
      const id = await insertId(proposals, {
        conversationId: input.conversationId,
        userId: input.userId,
        kind: input.kind,
        summary: input.summary ?? null,
        payload: input.payload,
        status: "pending",
        createdAt: now(),
      });
      await db.persist();
      const created = await repo.findProposal(id, input.userId);
      if (!created) throw new Error("Proposal could not be read back");
      return created;
    },

    /** Only moves a pending proposal. False when it was not pending. */
    async setProposalStatus(
      id: number,
      userId: string,
      status: "applied" | "rejected" | "expired",
      resultSummary?: string | null,
    ): Promise<boolean> {
      const existing = await repo.findProposal(id, userId);
      if (!existing || existing.status !== "pending") return false;
      await (
        await client()
      )
        .update(proposals)
        .set({
          status,
          appliedAt: status === "applied" ? now() : null,
          resultSummary: resultSummary ?? null,
        })
        .where(
          and(
            eq(proposals.id, id),
            eq(proposals.userId, userId),
            eq(proposals.status, "pending"),
          ),
        );
      await db.persist();
      return true;
    },
  };

  return repo;
}
