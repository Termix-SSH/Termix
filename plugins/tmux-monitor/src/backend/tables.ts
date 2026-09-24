import {
  adoptLegacyTable,
  defineTable,
  id,
  refHost,
  refUser,
  text,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * A user's tags on a tmux session, per host. Sessions are shared on the host
 * itself, but tags are per user: everyone who monitors the same host can tag
 * the same session differently.
 *
 * Adopted from core's tmux_session_tags, so the column names are the legacy
 * ones and the rename carries every existing row across. Core never indexed
 * it, so there is no legacy index to keep.
 */
export const sessionTags = adoptLegacyTable(
  "tmux_session_tags",
  defineTable("session_tags", {
    id: id(),
    userId: refUser(),
    hostId: refHost(),
    sessionName: text().notNull(),
    tag: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  }),
);

export const tables = [sessionTags];
