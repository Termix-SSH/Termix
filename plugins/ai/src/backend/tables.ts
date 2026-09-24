import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/*
 * Adopted from core's ai_* tables, so column and index names are the legacy
 * ones and the rename carries every row across.
 *
 * Messages and proposals point at their conversation with a plain integer
 * here, since the SDK only references users and ssh_data. The adoption
 * migrations keep that foreign key by hand, so deleting a conversation still
 * cascades.
 *
 * Provider API keys are not in these tables: they live in ctx.secrets under
 * "provider:<id>". A 2.8 database still has an api_key column, which the
 * boot migration empties after moving the key.
 */

export const providers = adoptLegacyTable(
  "ai_providers",
  defineTable(
    "providers",
    {
      id: id(),
      userId: refUser(),
      // ollama | anthropic | openai | gemini | openai_compatible
      providerType: text().notNull(),
      label: varchar().notNull(),
      // Required for ollama and openai_compatible, optional elsewhere.
      baseUrl: text(),
      // First few characters, kept in the clear so the UI can tell keys apart.
      apiKeyPrefix: text(),
      defaultModel: text(),
      enabled: boolean().notNull().default(true),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      uniques: [
        { name: "idx_ai_providers_user_label", columns: ["userId", "label"] },
      ],
    },
  ),
);

export const conversations = adoptLegacyTable(
  "ai_conversations",
  defineTable(
    "conversations",
    {
      id: id(),
      userId: refUser(),
      title: text(),
      providerId: integer(),
      model: text(),
      createdAt: timestamp().notNull().defaultNow(),
      updatedAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_ai_conversations_user",
          columns: ["userId", "updatedAt"],
        },
      ],
    },
  ),
);

export const messages = adoptLegacyTable(
  "ai_messages",
  defineTable(
    "messages",
    {
      id: id(),
      conversationId: integer().notNull(),
      // user | assistant | tool
      role: text().notNull(),
      content: text().notNull().default(""),
      // Serialized tool calls for this turn.
      toolCalls: text(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_ai_messages_conversation",
          columns: ["conversationId", "createdAt"],
        },
      ],
    },
  ),
);

/**
 * A change the assistant wants to make. Nothing here has been applied: the
 * payload is re-validated at apply time and only then dispatched.
 */
export const proposals = adoptLegacyTable(
  "ai_proposals",
  defineTable(
    "proposals",
    {
      id: id(),
      conversationId: integer().notNull(),
      userId: refUser(),
      // The propose_* tool name that produced this.
      kind: varchar().notNull(),
      summary: text(),
      payload: text().notNull().default("{}"),
      // pending | applied | rejected | expired
      status: varchar(32).notNull().default("pending"),
      appliedAt: text(),
      resultSummary: text(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    {
      indexes: [
        { name: "idx_ai_proposals_user", columns: ["userId", "status"] },
        {
          name: "idx_ai_proposals_conversation",
          columns: ["conversationId"],
        },
      ],
    },
  ),
);

export const tables = [providers, conversations, messages, proposals];
