import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * Sync cursors and stored timestamps do not share a layout.
 *
 * `updated_at` and `deleted_at` are TEXT columns written both by
 * `default(sql`CURRENT_TIMESTAMP`)` ("2026-07-29 10:11:21") and by
 * `new Date().toISOString()` ("2026-07-29T10:11:21.123Z"), while the desktop
 * sync engine always sends the ISO form as `since`. Comparing those as text is
 * decided at position 10, where ' ' (0x20) sorts below 'T' (0x54), so the
 * answer depends on which writer produced the row rather than on when it was
 * written -- and `column > :isoCursor` is false for every row stored in the
 * CURRENT_TIMESTAMP form, however new it is.
 *
 * Both layouts share a prefix once the separator is levelled, so comparing
 * "YYYY-MM-DD HH:MM:SS" on both sides is layout-independent. `replace` and
 * `substr` are used rather than `datetime()` to keep the expression portable
 * across engines.
 */
export const CANONICAL_TIMESTAMP_LENGTH = 19;

export function normalizeSyncTimestamp(value: string): string {
  return value.replace("T", " ").slice(0, CANONICAL_TIMESTAMP_LENGTH);
}

/**
 * `>=` rather than `>`: normalising truncates sub-second precision, so a strict
 * comparison would permanently skip rows written in the same second as the
 * cursor. Re-sending that boundary second costs nothing -- the sync engine only
 * pushes a row when one side is strictly newer, so rows equal on both sides are
 * a no-op.
 */
export function timestampAtOrAfter(column: SQLWrapper, since: string) {
  return sql`substr(replace(${column}, 'T', ' '), 1, ${CANONICAL_TIMESTAMP_LENGTH}) >= ${normalizeSyncTimestamp(since)}`;
}
