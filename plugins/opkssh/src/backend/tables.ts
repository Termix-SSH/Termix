import {
  adoptLegacyTable,
  defineTable,
  id,
  refHost,
  refUser,
  text,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * One cached certificate per user and host. Adopted from core's
 * opkssh_tokens, so the column and index names are the legacy ones.
 *
 * sshCert and privateKey are sealed with ctx.secrets.seal. Rows written by
 * 2.8 were encrypted with the user's data key instead; they do not unseal and
 * are treated as expired, which costs one browser sign-in.
 */
export const tokens = adoptLegacyTable(
  "opkssh_tokens",
  defineTable(
    "tokens",
    {
      id: id(),
      userId: refUser(),
      hostId: refHost(),
      sshCert: text().notNull(),
      privateKey: text().notNull(),
      email: text(),
      sub: text(),
      issuer: text(),
      audience: text(),
      createdAt: text().notNull().defaultNow(),
      expiresAt: varchar().notNull(),
      lastUsed: text(),
    },
    {
      uniques: [
        {
          name: "idx_opkssh_tokens_user_host",
          columns: ["userId", "hostId"],
        },
      ],
    },
  ),
);

export const tables = [tokens];
