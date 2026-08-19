import { and, desc, eq } from "drizzle-orm";
import {
  aiConversations,
  aiMessages,
  aiProposals,
  aiProviders,
} from "../db/schema.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";
import { formatSqlTimestamp } from "./sql-timestamp.js";

const now = (): string => formatSqlTimestamp(new Date());

export type AiProviderRecord = typeof aiProviders.$inferSelect;
export type AiConversationRecord = typeof aiConversations.$inferSelect;
export type AiMessageRecord = typeof aiMessages.$inferSelect;
export type AiProposalRecord = typeof aiProposals.$inferSelect;

export interface AiProviderInput {
  userId: string;
  providerType: string;
  label: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  defaultModel?: string | null;
  enabled?: boolean;
}

/**
 * Keeps the first few characters so the UI can tell two keys apart without
 * ever receiving the key itself.
 */
export function apiKeyPrefix(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  return apiKey.slice(0, 6);
}

export class AiRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  /**
   * Provider API keys are field-encrypted like any other credential. The key is
   * derived from the row id, which does not exist until after the insert, so a
   * new provider is written once and then re-encrypted in place with its real
   * id -- the same approach AlertRepository uses for channel configs.
   */
  private userDataKey(userId: string): Buffer | null {
    try {
      return DataCrypto.getUserDataKey(userId);
    } catch {
      // Crypto is not initialized (tests, early boot); leave the value as is.
      return null;
    }
  }

  private encryptApiKey(
    apiKey: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return apiKey;
    return DataCrypto.encryptRecord(
      "ai_providers",
      { id: recordId, apiKey },
      userId,
      userDataKey,
    ).apiKey;
  }

  private decryptApiKey(
    apiKey: string,
    userId: string,
    recordId: number | string,
  ): string {
    const userDataKey = this.userDataKey(userId);
    if (!userDataKey) return apiKey;
    try {
      return DataCrypto.decryptRecord(
        "ai_providers",
        { id: recordId, apiKey },
        userId,
        userDataKey,
      ).apiKey;
    } catch {
      // Rows written before encryption was enabled are still plaintext.
      return apiKey;
    }
  }

  // --- providers ---

  /** Never includes the key material; callers get the masked prefix only. */
  async listProviders(userId: string): Promise<AiProviderRecord[]> {
    const rows = await this.context.drizzle
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.userId, userId))
      .orderBy(aiProviders.id);

    return rows.map((row) => ({ ...row, apiKey: null }));
  }

  async findProvider(
    id: number,
    userId: string,
  ): Promise<AiProviderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(aiProviders)
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)))
      .limit(1);

    if (!rows[0]) return null;
    return { ...rows[0], apiKey: null };
  }

  /**
   * The one path that returns usable key material. Only the provider adapters
   * call this, immediately before an outbound request.
   */
  async findProviderWithSecret(
    id: number,
    userId: string,
  ): Promise<AiProviderRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(aiProviders)
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (!row.apiKey) return row;
    return {
      ...row,
      apiKey: this.decryptApiKey(row.apiKey, userId, row.id),
    };
  }

  async createProvider(input: AiProviderInput): Promise<AiProviderRecord> {
    const [created] = await insertReturning(this.context, aiProviders, {
      userId: input.userId,
      providerType: input.providerType,
      label: input.label,
      baseUrl: input.baseUrl ?? null,
      apiKey: input.apiKey ?? null,
      apiKeyPrefix: apiKeyPrefix(input.apiKey),
      defaultModel: input.defaultModel ?? null,
      enabled: input.enabled ?? true,
    });

    if (input.apiKey) {
      const encrypted = this.encryptApiKey(
        input.apiKey,
        input.userId,
        created.id,
      );
      if (encrypted !== input.apiKey) {
        await this.context.drizzle
          .update(aiProviders)
          .set({ apiKey: encrypted })
          .where(eq(aiProviders.id, created.id));
      }
    }

    await this.afterWrite();
    return { ...created, apiKey: null };
  }

  async updateProvider(
    id: number,
    userId: string,
    input: Partial<Omit<AiProviderInput, "userId">>,
  ): Promise<AiProviderRecord | null> {
    const existing = await this.findProvider(id, userId);
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
      if (input.apiKey) {
        updates.apiKey = this.encryptApiKey(input.apiKey, userId, id);
        updates.apiKeyPrefix = apiKeyPrefix(input.apiKey);
      } else {
        updates.apiKey = null;
        updates.apiKeyPrefix = null;
      }
    }

    await this.context.drizzle
      .update(aiProviders)
      .set(updates)
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)));

    await this.afterWrite();
    return this.findProvider(id, userId);
  }

  async deleteProvider(id: number, userId: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(aiProviders)
      .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)));

    const deleted = rowsAffected(result) > 0;
    if (deleted) await this.afterWrite();
    return deleted;
  }

  // --- conversations ---

  async listConversations(
    userId: string,
    limit = 50,
  ): Promise<AiConversationRecord[]> {
    return this.context.drizzle
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(limit);
  }

  async findConversation(
    id: number,
    userId: string,
  ): Promise<AiConversationRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(aiConversations)
      .where(
        and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createConversation(input: {
    userId: string;
    title?: string | null;
    providerId?: number | null;
    model?: string | null;
  }): Promise<AiConversationRecord> {
    const [created] = await insertReturning(this.context, aiConversations, {
      userId: input.userId,
      title: input.title ?? null,
      providerId: input.providerId ?? null,
      model: input.model ?? null,
    });
    await this.afterWrite();
    return created;
  }

  async touchConversation(id: number, title?: string | null): Promise<void> {
    const updates: Record<string, unknown> = { updatedAt: now() };
    if (title) updates.title = title;
    await this.context.drizzle
      .update(aiConversations)
      .set(updates)
      .where(eq(aiConversations.id, id));
    await this.afterWrite();
  }

  async deleteConversation(id: number, userId: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(aiConversations)
      .where(
        and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)),
      );
    const deleted = rowsAffected(result) > 0;
    if (deleted) await this.afterWrite();
    return deleted;
  }

  // --- messages ---

  async listMessages(conversationId: number): Promise<AiMessageRecord[]> {
    return this.context.drizzle
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.id);
  }

  async appendMessage(input: {
    conversationId: number;
    role: string;
    content: string;
    toolCalls?: string | null;
  }): Promise<AiMessageRecord> {
    const [created] = await insertReturning(this.context, aiMessages, {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls ?? null,
    });
    await this.afterWrite();
    return created;
  }

  // --- proposals ---

  async listProposals(
    userId: string,
    conversationId?: number,
  ): Promise<AiProposalRecord[]> {
    const where = conversationId
      ? and(
          eq(aiProposals.userId, userId),
          eq(aiProposals.conversationId, conversationId),
        )
      : eq(aiProposals.userId, userId);

    return this.context.drizzle
      .select()
      .from(aiProposals)
      .where(where)
      .orderBy(desc(aiProposals.id));
  }

  async findProposal(
    id: number,
    userId: string,
  ): Promise<AiProposalRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.id, id), eq(aiProposals.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createProposal(input: {
    conversationId: number;
    userId: string;
    kind: string;
    summary?: string | null;
    payload: string;
  }): Promise<AiProposalRecord> {
    const [created] = await insertReturning(this.context, aiProposals, {
      conversationId: input.conversationId,
      userId: input.userId,
      kind: input.kind,
      summary: input.summary ?? null,
      payload: input.payload,
      status: "pending",
    });
    await this.afterWrite();
    return created;
  }

  async setProposalStatus(
    id: number,
    userId: string,
    status: "applied" | "rejected" | "expired",
    resultSummary?: string | null,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(aiProposals)
      .set({
        status,
        appliedAt: status === "applied" ? now() : null,
        resultSummary: resultSummary ?? null,
      })
      .where(
        and(
          eq(aiProposals.id, id),
          eq(aiProposals.userId, userId),
          eq(aiProposals.status, "pending"),
        ),
      );

    const updated = rowsAffected(result) > 0;
    if (updated) await this.afterWrite();
    return updated;
  }

  // --- account deletion ---

  async deleteByUserId(userId: string): Promise<void> {
    // ai_messages and ai_proposals cascade from ai_conversations.
    await this.context.drizzle
      .delete(aiConversations)
      .where(eq(aiConversations.userId, userId));
    await this.context.drizzle
      .delete(aiProviders)
      .where(eq(aiProviders.userId, userId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
