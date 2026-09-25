/** A GitHub-like public namespace: lowercase, starts alphanumeric, 1-39 chars. */
export const HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{0,38}$/;

const RESERVED_HANDLES = new Set(["u", "me", "keys", "check", "admin", "api"]);

const MAX_DESCRIPTION_LENGTH = 500;

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle) && !RESERVED_HANDLES.has(handle);
}

export function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null;
}

export function cleanLabel(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

/** Validity in days: a positive whole number, at most ten years. */
export function clampValidityDays(value: unknown, fallback: number): number {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return fallback;
  return Math.min(Math.floor(days), 3650);
}

interface DbError {
  code?: string;
  errno?: number;
  message?: string;
  cause?: unknown;
}

function errorChain(error: unknown): DbError[] {
  const chain: DbError[] = [];
  let current = error as DbError | undefined;
  while (current && typeof current === "object" && chain.length < 5) {
    chain.push(current);
    current = current.cause as DbError | undefined;
  }
  return chain;
}

/** A UNIQUE violation on sqlite, Postgres or MySQL. */
export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some(
    (entry) =>
      entry.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      entry.code === "23505" ||
      entry.code === "ER_DUP_ENTRY" ||
      entry.errno === 1062 ||
      (typeof entry.message === "string" &&
        entry.message.includes("UNIQUE constraint failed")),
  );
}

/** Whether a UNIQUE violation was on user_id (one handle per user) rather than the handle. */
export function isUserIdViolation(error: unknown): boolean {
  return errorChain(error).some(
    (entry) =>
      typeof entry.message === "string" &&
      (entry.message.includes("user_id") || entry.message.includes("userId")),
  );
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
