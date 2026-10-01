/** IANA zone names use underscores, but people type and paste spaces. */
export function normalizeTimezone(timezone: string): string {
  return timezone.trim().replace(/\s+/g, "_");
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes the timezone a user typed and reports whether it is usable.
 * A blank field is valid: it means "use local time".
 */
export function validateClockTimezone(timezone: unknown): {
  timezone?: string;
  valid: boolean;
} {
  if (typeof timezone !== "string" || timezone.trim() === "") {
    return { timezone: undefined, valid: true };
  }
  const normalized = normalizeTimezone(timezone);
  return { timezone: normalized, valid: isValidTimezone(normalized) };
}
