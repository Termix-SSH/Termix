/** Six-digit codes, or a backup code of up to eight letters and digits. */
export function normalizeTotpInput(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

export function isValidTotpInput(value: string): boolean {
  return /^[A-Z0-9]{6,8}$/.test(value);
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}
