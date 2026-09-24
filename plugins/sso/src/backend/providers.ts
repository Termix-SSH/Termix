import { and, asc, desc, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { applyProviderDefaults, normalizeIssuer } from "./oidc-protocol.js";
import {
  SSO_PROVIDER_TYPES,
  type OidcConfig,
  type ProviderRow,
  type ResolvedProvider,
  type SsoProviderType,
} from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Identities from the env-configured provider use this provider id. */
export const ENV_PROVIDER_ID = "legacy-oidc";
/** The login instance id of the env-configured provider. */
export const ENV_INSTANCE_ID = "0";

const SECRET_FIELDS = ["client_secret"] as const;
const LEGACY_PREFIXES = ["encoded:", "encrypted:"];

export function isSsoType(type: unknown): type is SsoProviderType {
  return SSO_PROVIDER_TYPES.includes(type as SsoProviderType);
}

export function getOidcConfigFromEnv(): OidcConfig | null {
  const client_id = process.env.OIDC_CLIENT_ID;
  const client_secret = process.env.OIDC_CLIENT_SECRET;
  const issuer_url = process.env.OIDC_ISSUER_URL;
  const authorization_url = process.env.OIDC_AUTHORIZATION_URL;
  const token_url = process.env.OIDC_TOKEN_URL;
  if (
    !client_id ||
    !client_secret ||
    !issuer_url ||
    !authorization_url ||
    !token_url
  ) {
    return null;
  }
  return {
    client_id,
    client_secret,
    issuer_url,
    authorization_url,
    token_url,
    userinfo_url: process.env.OIDC_USERINFO_URL || "",
    identifier_path: process.env.OIDC_IDENTIFIER_PATH || "sub",
    name_path: process.env.OIDC_NAME_PATH || "name",
    scopes: process.env.OIDC_SCOPES || "openid email profile",
    allowed_users: process.env.OIDC_ALLOWED_USERS || "",
    admin_group: process.env.OIDC_ADMIN_GROUP || "",
    group_claim: process.env.OIDC_GROUP_CLAIM || "",
    role_map: process.env.OIDC_ROLE_MAP || "",
  };
}

export function isEnvOverrideEnabled(): boolean {
  return process.env.OIDC_ENV_OVERRIDE?.toLowerCase() === "true";
}

function envProvider(config: OidcConfig): ResolvedProvider {
  // Env providers were set up against the 2.8 callback and cannot be edited.
  return { config, type: "oidc", rowId: null, legacyCallback: true };
}

export type ProviderStore = ReturnType<typeof createProviderStore>;

export function createProviderStore(ctx: PluginContext, table: Table) {
  const client = () => ctx.db.client<Drizzle>();

  /** Opens a stored secret: sealed, or the 2.8 base64 forms. */
  async function openSecret(value: string): Promise<string> {
    const prefix = LEGACY_PREFIXES.find((p) => value.startsWith(p));
    if (prefix) {
      try {
        return Buffer.from(value.slice(prefix.length), "base64").toString(
          "utf8",
        );
      } catch {
        return "";
      }
    }
    const opened = await ctx.secrets.unseal(value);
    // A value seal() never wrote was stored in the clear by hand.
    return opened ?? value;
  }

  async function parseConfig(raw: string): Promise<Record<string, unknown>> {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(raw);
    } catch {
      return {};
    }
    for (const field of SECRET_FIELDS) {
      const value = config[field];
      if (typeof value === "string" && value) {
        config[field] = await openSecret(value);
      }
    }
    return config;
  }

  async function sealConfig(config: Record<string, unknown>): Promise<string> {
    const out = { ...config };
    for (const field of SECRET_FIELDS) {
      const value = out[field];
      if (typeof value === "string" && value) {
        out[field] = await ctx.secrets.seal(value);
      }
    }
    return JSON.stringify(out);
  }

  async function listRows(): Promise<ProviderRow[]> {
    const drizzle = await client();
    const rows = (await drizzle
      .select()
      .from(table)
      .orderBy(asc(table.displayOrder), asc(table.id))) as ProviderRow[];
    return rows.filter((row) => isSsoType(row.type));
  }

  async function findRow(id: number): Promise<ProviderRow | null> {
    const drizzle = await client();
    const rows = (await drizzle
      .select()
      .from(table)
      .where(eq(table.id, id))
      .limit(1)) as ProviderRow[];
    const row = rows[0];
    return row && isSsoType(row.type) ? row : null;
  }

  async function resolveRow(row: ProviderRow): Promise<ResolvedProvider> {
    const type = row.type as SsoProviderType;
    const config = applyProviderDefaults(
      (await parseConfig(row.config)) as unknown as OidcConfig,
      type,
    );
    return {
      config,
      type,
      rowId: row.id,
      legacyCallback: !!row.legacyCallback,
    };
  }

  return {
    parseConfig,
    sealConfig,
    listRows,
    findRow,

    /** Login instances: env override, rows, or the env provider alone. */
    async listInstances(): Promise<
      Array<{ id: string; label: string; type: SsoProviderType }>
    > {
      const env = getOidcConfigFromEnv();
      const envInstance = {
        id: ENV_INSTANCE_ID,
        label: "SSO",
        type: "oidc" as const,
      };
      if (env && isEnvOverrideEnabled()) return [envInstance];
      const rows = (await listRows()).filter((row) => row.enabled);
      const instances = rows.map((row) => ({
        id: String(row.id),
        label: row.name,
        type: row.type as SsoProviderType,
      }));
      if (instances.length === 0 && env) instances.push(envInstance);
      return instances;
    },

    /**
     * The provider for a login. With no id, the env provider or the first
     * enabled row, as 2.8 did.
     */
    async resolve(rowId: number | null): Promise<ResolvedProvider | null> {
      const env = getOidcConfigFromEnv();
      if (env && isEnvOverrideEnabled()) return envProvider(env);
      if (rowId != null) {
        const row = await findRow(rowId);
        return row?.enabled ? resolveRow(row) : null;
      }
      if (env) return envProvider(env);
      const first = (await listRows()).find((row) => row.enabled);
      return first ? resolveRow(first) : null;
    },

    /** The provider a back-channel logout token's issuer belongs to. */
    async resolveByIssuer(issuer: string): Promise<ResolvedProvider | null> {
      const target = normalizeIssuer(issuer);
      const env = getOidcConfigFromEnv();
      const envMatches =
        !!env?.issuer_url && normalizeIssuer(env.issuer_url) === target;
      if (envMatches && isEnvOverrideEnabled()) return envProvider(env!);
      for (const row of await listRows()) {
        if (!row.enabled) continue;
        const resolved = await resolveRow(row);
        if (
          resolved.config.issuer_url &&
          normalizeIssuer(resolved.config.issuer_url) === target
        ) {
          return resolved;
        }
      }
      return envMatches ? envProvider(env!) : null;
    },

    async create(input: {
      name: string;
      type: SsoProviderType;
      enabled: boolean;
      displayOrder: number;
      config: Record<string, unknown>;
    }): Promise<ProviderRow> {
      const drizzle = await client();
      const now = new Date().toISOString();
      await drizzle.insert(table).values({
        name: input.name,
        type: input.type,
        enabled: input.enabled,
        displayOrder: input.displayOrder,
        config: await sealConfig(input.config),
        legacyCallback: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.persist();
      // No returning() on every engine: find the row by what was written.
      const rows = (await drizzle
        .select()
        .from(table)
        .where(and(eq(table.name, input.name), eq(table.createdAt, now)))
        .orderBy(desc(table.id))
        .limit(1)) as ProviderRow[];
      return rows[0];
    },

    async update(
      id: number,
      values: Partial<{
        name: string;
        enabled: boolean;
        displayOrder: number;
        config: Record<string, unknown>;
        legacyCallback: boolean;
      }>,
    ): Promise<ProviderRow | null> {
      const drizzle = await client();
      const { config, ...rest } = values;
      await drizzle
        .update(table)
        .set({
          ...rest,
          ...(config ? { config: await sealConfig(config) } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(table.id, id));
      await ctx.db.persist();
      return findRow(id);
    },

    async remove(id: number): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(table).where(eq(table.id, id));
      await ctx.db.persist();
    },
  };
}
