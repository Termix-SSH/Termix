/**
 * Parses a timestamp from the API. SQLite stores CURRENT_TIMESTAMP as UTC
 * with no zone ("2026-10-09 23:11:54"), which browsers read as local time.
 */
export function parseServerTime(ts: string): Date {
  const bare = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(ts);
  return new Date(bare ? `${ts.replace(" ", "T")}Z` : ts);
}
