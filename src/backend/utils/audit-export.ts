import type { AuditLogRecord } from "../database/repositories/audit-log-repository.js";

/** Column order for CSV export; also the header row. */
const COLUMNS = [
  "id",
  "timestamp",
  "username",
  "userId",
  "action",
  "resourceType",
  "resourceId",
  "resourceName",
  "success",
  "ipAddress",
  "userAgent",
  "errorMessage",
  "details",
] as const;

/**
 * RFC 4180 field escaping.
 *
 * The leading-character guard is not part of RFC 4180: a field starting with
 * `=`, `+`, `-` or `@` is treated as a formula by spreadsheet software, so an
 * audit entry containing an attacker-chosen resource name could execute on
 * open. Prefixing with a single quote neutralises that while keeping the value
 * readable.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = typeof value === "boolean" ? String(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: AuditLogRecord[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      COLUMNS.map((column) =>
        escapeCsvField((row as Record<string, unknown>)[column]),
      ).join(","),
    );
  }
  // Trailing newline so the file ends cleanly when appended to or concatenated.
  return `${lines.join("\n")}\n`;
}

/**
 * Newline-delimited JSON: one entry per line, which is what log shippers and
 * SIEM bulk endpoints expect, and which streams without holding the whole set.
 */
export function toNdjson(rows: AuditLogRecord[]): string {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length ? "\n" : "")
  );
}

export function exportFilename(format: "csv" | "ndjson", now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `termix-audit-${stamp}.${format === "csv" ? "csv" : "ndjson"}`;
}
