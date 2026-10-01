-- automations 0002: unlink_channels
-- Hand-written: channels moved from core's notification_channels to the
-- alerts plugin, so the link table drops its foreign key to the old table.
-- SQLite cannot drop a constraint, so the table is rebuilt.

CREATE TABLE IF NOT EXISTS "p_automations_channels_v2" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "automation_id" integer NOT NULL,
  "channel_id" integer NOT NULL,
  FOREIGN KEY ("automation_id") REFERENCES "p_automations_automations" ("id") ON DELETE CASCADE
);
INSERT INTO "p_automations_channels_v2" ("id", "automation_id", "channel_id") SELECT "id", "automation_id", "channel_id" FROM "p_automations_channels";
DROP TABLE "p_automations_channels";
ALTER TABLE "p_automations_channels_v2" RENAME TO "p_automations_channels";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_channels_pair" ON "p_automations_channels" ("automation_id", "channel_id");
