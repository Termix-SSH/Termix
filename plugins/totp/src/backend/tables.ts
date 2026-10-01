import {
  defineTable,
  encryptedText,
  refUser,
  timestamp,
} from "@termix/plugin-sdk/db";

/**
 * One row per user who started or finished setup. The secret columns hold
 * values sealed with ctx.secrets.seal, so they can be read during login
 * without an acting user. A non-null secret means the user is enrolled.
 */
export const enrollments = defineTable("enrollments", {
  userId: refUser().primaryKey(),
  secret: encryptedText(),
  // Set by /setup, promoted to secret once a code from it verifies.
  pendingSecret: encryptedText(),
  // A sealed JSON array of the unused backup codes.
  backupCodes: encryptedText(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const tables = [enrollments];
