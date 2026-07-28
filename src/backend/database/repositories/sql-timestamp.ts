/**
 * Timestamp columns are stored as text defaulting to `CURRENT_TIMESTAMP`, which
 * every supported engine writes as `YYYY-MM-DD HH:MM:SS` in UTC. That format
 * sorts lexicographically in time order, so retention cutoffs can be plain
 * string comparisons.
 *
 * Computing the cutoff here rather than with `datetime('now', ?)` keeps the
 * queries free of engine-specific date functions.
 */
export function sqlTimestampDaysAgo(
  days: number,
  now: Date = new Date(),
): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return formatSqlTimestamp(cutoff);
}

export function formatSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
