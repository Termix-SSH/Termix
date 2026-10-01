export function toFixedNum(
  n: number | null | undefined,
  digits = 2,
): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

export function kibToGiB(kib: number): number {
  return kib / (1024 * 1024);
}

export function errorMessage(error: unknown, fallback = "Unknown error") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
