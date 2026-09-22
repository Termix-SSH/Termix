/**
 * Table definitions a plugin owns.
 *
 * A definition is a plain descriptor, not a live Drizzle table. Core turns it
 * into one at runtime (src/backend/plugins/table-builder.ts) and emits the DDL
 * for whichever dialect the server is on, which keeps this entry a description
 * of the contract rather than an implementation a plugin could reach around.
 *
 * Why one table object and three DDL emitters, rather than three table
 * objects: the sqlite-core definitions already encode correctly for every
 * engine at query time. text and integer encode as themselves; a boolean
 * writes 1/0, which Postgres and MySQL both accept; real is a plain number.
 * What genuinely differs between the engines is DDL. See the header of
 * scripts/generate-dialect-schema.cjs, which this mapping is taken from.
 */

export type PluginColumnType =
  | "id"
  | "text"
  | "varchar"
  | "integer"
  | "bigint"
  | "boolean"
  | "timestamp"
  | "json"
  | "encryptedText"
  | "refUser"
  | "refHost";

export interface PluginColumn {
  readonly type: PluginColumnType;
  /** varchar only. The ceiling MySQL can index. */
  readonly length?: number;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly defaultValue?: string | number | boolean | null;
  /** timestamp only: default CURRENT_TIMESTAMP. */
  readonly defaultNow?: boolean;
}

/** The longest string MySQL will index, and so the width of every key column. */
export const KEY_LENGTH = 255;

interface Builder<T extends PluginColumn = PluginColumn> {
  notNull: () => Builder<T>;
  primaryKey: () => Builder<T>;
  unique: () => Builder<T>;
  default: (value: string | number | boolean | null) => Builder<T>;
  defaultNow: () => Builder<T>;
  readonly column: PluginColumn;
}

function builder(column: PluginColumn): Builder {
  const next = (patch: Partial<PluginColumn>) =>
    builder({ ...column, ...patch });
  return {
    column,
    notNull: () => next({ notNull: true }),
    primaryKey: () => next({ primaryKey: true, notNull: true }),
    unique: () => next({ unique: true }),
    default: (defaultValue) => next({ defaultValue }),
    defaultNow: () => next({ defaultNow: true }),
  };
}

/** Auto-incrementing surrogate key: integer on sqlite, serial, auto_increment. */
export const id = () =>
  builder({ type: "id", primaryKey: true, notNull: true });

/** Unbounded string. Never indexable: MySQL cannot index TEXT. */
export const text = () => builder({ type: "text" });

/** Bounded string. Indexable on every engine. */
export const varchar = (length: number = KEY_LENGTH) =>
  builder({ type: "varchar", length });

export const integer = () => builder({ type: "integer" });
export const bigint = () => builder({ type: "bigint" });
export const boolean = () => builder({ type: "boolean" });

/** Stored as text on every engine. See src/backend/database/repositories/sql-timestamp.ts. */
export const timestamp = () => builder({ type: "timestamp" });

/** JSON held as text. Never indexable, for the same reason as text(). */
export const json = () => builder({ type: "json" });

/** Text encrypted with the owning user's key before it is written. */
export const encryptedText = () => builder({ type: "encryptedText" });

/** Foreign key to users.id, cascading on delete. */
export const refUser = () =>
  builder({ type: "refUser", length: KEY_LENGTH, notNull: true });

/** Foreign key to ssh_data.id, cascading on delete. */
export const refHost = () => builder({ type: "refHost", notNull: true });

export interface PluginTableIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface PluginTableOptions {
  readonly indexes?: readonly PluginTableIndex[];
  readonly uniques?: readonly PluginTableIndex[];
}

export interface PluginTableDefinition {
  /** The unprefixed name as the plugin wrote it. */
  readonly name: string;
  readonly columns: Readonly<Record<string, PluginColumn>>;
  readonly indexes: readonly PluginTableIndex[];
}

/** Columns that can never carry an index, because MySQL cannot index them. */
const UNINDEXABLE: ReadonlySet<PluginColumnType> = new Set([
  "text",
  "json",
  "encryptedText",
]);

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

type Columns = Record<string, Builder | PluginColumn>;

function unwrap(value: Builder | PluginColumn): PluginColumn {
  return "column" in value ? value.column : value;
}

/**
 * Declares a table this plugin owns.
 *
 * The name is unprefixed here; core prefixes it with p_<plugin id>_ when the
 * definition is registered, so a plugin cannot name a table into another
 * plugin's namespace or into core's.
 */
export function defineTable(
  name: string,
  columns: Columns,
  options: PluginTableOptions = {},
): PluginTableDefinition {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Table name "${name}" must be lower snake_case and start with a letter`,
    );
  }

  const resolved: Record<string, PluginColumn> = {};
  for (const [key, value] of Object.entries(columns)) {
    resolved[key] = unwrap(value);
  }

  if (Object.keys(resolved).length === 0) {
    throw new Error(`Table "${name}" declares no columns`);
  }

  const indexes = [
    ...(options.uniques ?? []).map((entry) => ({ ...entry, unique: true })),
    ...(options.indexes ?? []),
  ];

  // Checked here rather than at migration time so the error names the table
  // and column while the author is still looking at the definition.
  for (const index of indexes) {
    if (!NAME_PATTERN.test(index.name)) {
      throw new Error(
        `Index name "${index.name}" must be lower snake_case and start with a letter`,
      );
    }
    if (index.columns.length === 0) {
      throw new Error(`Index "${index.name}" names no columns`);
    }
    for (const column of index.columns) {
      const declared = resolved[column];
      if (!declared) {
        throw new Error(
          `Index "${index.name}" names "${column}", which table "${name}" does not declare`,
        );
      }
      if (UNINDEXABLE.has(declared.type)) {
        throw new Error(
          `Index "${index.name}" covers "${column}", a ${declared.type} column. ` +
            `MySQL cannot index an unbounded column: use varchar(n) instead.`,
        );
      }
    }
  }

  return { name, columns: resolved, indexes };
}

/** p_<id with - as _>_ - the prefix every table a plugin owns carries. */
export function tablePrefix(pluginId: string): string {
  return `p_${pluginId.replace(/-/g, "_")}_`;
}

/** The physical table name for a definition owned by a plugin. */
export function prefixedTableName(pluginId: string, name: string): string {
  return `${tablePrefix(pluginId)}${name}`;
}

/**
 * Legacy core tables, and the one plugin allowed to adopt each.
 *
 * Adoption is how a feature keeps its rows when it moves out of core: the
 * table is renamed into the plugin's namespace rather than copied. One owner
 * per table, because two plugins adopting the same one would mean whichever
 * activated second found it already gone.
 *
 * Shared with the CLI so a migration that reaches for someone else's table is
 * caught at build time as well as at activation.
 */
export const LEGACY_TABLE_OWNERS: Readonly<Record<string, string>> = {
  fleets: "fleets",
  fleet_members: "fleets",
  fleet_inventory: "fleets",
  user_workspaces: "workspaces",
  network_topology: "network-topology",
  snippets: "snippets",
  snippet_folders: "snippets",
  snippet_access: "snippets",
  c2s_tunnel_presets: "tunnels",
  command_history: "ssh-terminal",
  file_manager_recent: "file-manager",
  file_manager_pinned: "file-manager",
  file_manager_shortcuts: "file-manager",
  transfer_recent: "file-manager",
  tmux_session_tags: "tmux-monitor",
  session_shares: "session-sharing",
  session_share_participants: "session-sharing",
  collab_rooms: "session-sharing",
  collab_room_members: "session-sharing",
  session_recordings: "session-recording",
  host_metrics_preferences: "host-metrics",
  host_health_checks: "host-metrics",
  host_health_history: "host-metrics",
  host_metrics_history: "host-metrics",
  proxmox_stats_preferences: "proxmox",
  proxmox_node_history: "proxmox",
  automations: "automations",
  automation_trigger_state: "automations",
  automation_schedules: "automations",
  automation_runs: "automations",
  automation_run_steps: "automations",
  automation_channels: "automations",
  ai_providers: "ai",
  ai_conversations: "ai",
  ai_messages: "ai",
  ai_proposals: "ai",
  homepage_items: "homepage",
  homepage_layouts: "homepage",
  dashboard_service_links: "homepage",
  secret_sources: "secret-sources",
  opkssh_tokens: "opkssh",
  vault_profiles: "vault",
  vault_tokens: "vault",
  termix_identities: "termix-identity",
  termix_identity_keys: "termix-identity",
  termix_identity_ca: "termix-identity",
  webauthn_credentials: "webauthn",
  sso_providers: "sso",
};
