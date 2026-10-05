/**
 * 26.10.0 dropped the columns 2.9.0 kept for a downgrade to 2.8, and the
 * one-time 2.8 moves that copied them into plugins went with them. A 2.8
 * database has to pass through 2.9 first, or that data is lost.
 *
 * A 2.9 database has the plugins table; a 2.8 one has hosts but no plugins.
 */
export const PRE_29_DATABASE_ERROR =
  "This database is from Termix 2.8 or older. Upgrade to Termix 2.9.1 and start it once so it can move your data, then upgrade to this version.";

export async function assertNotPre29Database(
  hasTable: (name: string) => boolean | Promise<boolean>,
): Promise<void> {
  if ((await hasTable("ssh_data")) && !(await hasTable("plugins"))) {
    throw new Error(PRE_29_DATABASE_ERROR);
  }
}
