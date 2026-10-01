import {
  defineTable,
  id,
  refHost,
  refUser,
  text,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * One issued certificate per user and host. sshCert and privateKey are
 * sealed with ctx.secrets.seal. 2.8 kept Step CA certificates in
 * opkssh_tokens; those are left to expire.
 */
export const certs = defineTable(
  "certs",
  {
    id: id(),
    userId: refUser(),
    hostId: refHost(),
    sshCert: text().notNull(),
    privateKey: text().notNull(),
    email: text(),
    createdAt: text().notNull().defaultNow(),
    expiresAt: varchar().notNull(),
  },
  {
    uniques: [
      { name: "idx_step_ca_certs_user_host", columns: ["userId", "hostId"] },
    ],
  },
);

export const tables = [certs];
