/**
 * 26.10.0 dropped the columns 2.9.0 kept for a downgrade to 2.8, and the
 * one-time 2.8 moves that copied them into plugins went with them. A 2.8
 * database has to pass through 2.9 first, or that data is lost.
 *
 * 2.8 already had a plugins table, so the marker is plugin_migrations, which
 * 2.9.0 added on every dialect. A 2.8 database has hosts but not that.
 */
export const PRE_29_DATABASE_ERROR =
  "This database is from Termix 2.8 or older. Upgrade to Termix 2.9.1 and start it once so it can move your data, then upgrade to this version.";

export async function assertNotPre29Database(
  hasTable: (name: string) => boolean | Promise<boolean>,
): Promise<void> {
  if ((await hasTable("ssh_data")) && !(await hasTable("plugin_migrations"))) {
    throw new Error(PRE_29_DATABASE_ERROR);
  }
}
