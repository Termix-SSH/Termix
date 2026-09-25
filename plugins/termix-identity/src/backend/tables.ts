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

/** One public handle per user. Adopted from core's termix_identities. */
export const identities = adoptLegacyTable(
  "termix_identities",
  defineTable("identities", {
    id: id(),
    userId: refUser().unique(),
    handle: varchar().notNull().unique(),
    description: text(),
    createdAt: text().notNull().defaultNow(),
    updatedAt: text().notNull().defaultNow(),
  }),
);

/**
 * Published public keys, plaintext because the resolver serves them without
 * auth. Adopted from core's termix_identity_keys. The migrations keep the
 * legacy links to identities (cascade) and ssh_credentials (set null) by hand.
 */
export const keys = adoptLegacyTable(
  "termix_identity_keys",
  defineTable(
    "keys",
    {
      id: id(),
      identityId: integer().notNull(),
      userId: refUser(),
      publicKey: text().notNull(),
      keyType: text().notNull(),
      algorithm: text().notNull(),
      label: text(),
      comment: text(),
      source: text().notNull().default("manual"),
      credentialId: integer(),
      enabled: boolean().notNull().default(true),
      createdAt: text().notNull().defaultNow(),
    },
    {
      indexes: [
        {
          name: "idx_termix_identity_keys_identity",
          columns: ["identityId"],
        },
      ],
    },
  ),
);

/**
 * One certificate authority per identity. The private key is sealed with
 * ctx.secrets.seal; 2.8 rows are resealed by core's
 * termix-identity-ca-migration. Adopted from core's termix_identity_ca.
 */
export const ca = adoptLegacyTable(
  "termix_identity_ca",
  defineTable("ca", {
    id: id(),
    identityId: integer().notNull().unique(),
    userId: refUser(),
    publicKey: text().notNull(),
    privateKey: text().notNull(),
    validityDays: integer().notNull().default(90),
    createdAt: text().notNull().defaultNow(),
    updatedAt: text().notNull().defaultNow(),
  }),
);

export const tables = [identities, keys, ca];
