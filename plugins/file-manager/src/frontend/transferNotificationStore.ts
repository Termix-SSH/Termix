const PENDING_KEY = "termix_pending_transfers";
const NOTIFIED_KEY = "termix_notified_transfers";

function readJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeJsonArray(key: string, values: string[]): void {
  localStorage.setItem(key, JSON.stringify(values));
}

export function registerPendingTransfer(transferId: string): void {
  const pending = readJsonArray(PENDING_KEY);
  if (!pending.includes(transferId)) {
    writeJsonArray(PENDING_KEY, [...pending, transferId]);
  }
}

export function markTransferNotified(transferId: string): void {
  const notified = readJsonArray(NOTIFIED_KEY);
  if (!notified.includes(transferId)) {
    writeJsonArray(NOTIFIED_KEY, [...notified, transferId].slice(-200));
  }
  writeJsonArray(
    PENDING_KEY,
    readJsonArray(PENDING_KEY).filter((id) => id !== transferId),
  );
}

export function isTransferNotified(transferId: string): boolean {
  return readJsonArray(NOTIFIED_KEY).includes(transferId);
}

export function getPendingTransferIds(): string[] {
  return readJsonArray(PENDING_KEY);
}

export function clearStalePendingTransfer(transferId: string): void {
  writeJsonArray(
    PENDING_KEY,
    readJsonArray(PENDING_KEY).filter((id) => id !== transferId),
  );
}
