// A server keeps sync ids unique across users, so one can never name another
// user's host. A desktop keeps each linked account as its own local user, and
// a host or login shared between two of them arrives under the same sync id.
const PER_USER_ON_DESKTOP = new Set(["ssh_data", "ssh_credentials"]);

/** The statements that set up the sync id index for one table. */
export function syncIdIndexStatements(
  table: string,
  embedded: boolean,
): string[] {
  if (embedded && PER_USER_ON_DESKTOP.has(table)) {
    return [
      `DROP INDEX IF EXISTS idx_${table}_sync_id`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_user_sync_id ON ${table}(user_id, sync_id)`,
    ];
  }
  return [
    `DROP INDEX IF EXISTS idx_${table}_user_sync_id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_sync_id ON ${table}(sync_id)`,
  ];
}
