import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  refHost,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * userId is a plain column, not refUser(): a recording is evidence about the
 * host as much as the person, so it outlives the account. The plugin listens
 * for user.deleted and clears userId itself instead of cascading. username
 * keeps an anonymized row attributable.
 */
export const sessionRecordings = adoptLegacyTable(
  "session_recordings",
  defineTable(
    "session_recordings",
    {
      id: id(),
      hostId: refHost(),
      userId: varchar(),
      username: text(),
      accessId: integer(),
      startedAt: timestamp().notNull().defaultNow(),
      endedAt: timestamp(),
      duration: integer(),
      commands: text(),
      dangerousActions: text(),
      recordingPath: text(),
      protocol: text().notNull().default("ssh"),
      format: text().notNull().default("text"),
      terminatedByOwner: boolean().default(false),
      terminationReason: text(),
    },
    {
      indexes: [
        {
          name: "idx_session_recordings_user_started",
          columns: ["userId", "startedAt"],
        },
        { name: "idx_session_recordings_host", columns: ["hostId"] },
      ],
    },
  ),
);

export const tables = [sessionRecordings];
