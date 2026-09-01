/**
 * Extract a stable, human-readable message from an unknown thrown value.
 *
 * A thrown value is not guaranteed to be an `Error` — libraries may throw
 * strings or plain objects, which carry no useful `.message`. When that
 * happens the caller gets `fallback` instead, so error paths never surface a
 * raw `[object Object]` in logs or UI.
 */
export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return error instanceof Error ? error.message : fallback;
}
