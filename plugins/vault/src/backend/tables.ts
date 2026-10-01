import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  refUser,
  text,
  varchar,
} from "@termix/plugin-sdk/db";

/**
 * Vault signer profiles: connection settings only, no secrets. A shared
 * profile is visible to every user. Adopted from core's vault_profiles.
 */
export const profiles = adoptLegacyTable(
  "vault_profiles",
  defineTable("profiles", {
    id: id(),
    userId: refUser(),
    name: text().notNull(),
    description: text(),
    folder: text(),
    tags: text(),
    vaultAddr: text().notNull(),
    vaultNamespace: text(),
    oidcMount: text(),
    oidcRole: text(),
    sshMount: text(),
    sshRole: text().notNull(),
    validPrincipals: text(),
    keyType: text(),
    shared: boolean().notNull().default(false),
    syncId: varchar().unique(),
    createdAt: text().notNull().defaultNow(),
    updatedAt: text().notNull().defaultNow(),
  }),
);

/**
 * One signed certificate and its ephemeral key per user and profile, sealed
 * with ctx.secrets.seal. Adopted from core's vault_tokens. Rows 2.8 wrote were
 * encrypted with the user's data key; they do not unseal and are dropped.
 *
 * profileId has no foreign key on a fresh install (the SDK has no builder
 * for one to the plugin's own table), so deleting a profile deletes its
 * tokens in code. Upgraded installs keep 2.8's cascading key.
 */
export const tokens = adoptLegacyTable(
  "vault_tokens",
  defineTable(
    "tokens",
    {
      id: id(),
      userId: refUser(),
      profileId: integer().notNull(),
      sshCert: text().notNull(),
      privateKey: text().notNull(),
      createdAt: text().notNull().defaultNow(),
      expiresAt: varchar().notNull(),
      lastUsed: text(),
    },
    {
      uniques: [
        {
          name: "idx_vault_tokens_user_profile",
          columns: ["userId", "profileId"],
        },
      ],
    },
  ),
);

export const tables = [profiles, tokens];
