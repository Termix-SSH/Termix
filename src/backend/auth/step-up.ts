/**
 * When each signed in user last proved a second factor, for rules that ask
 * again before something sensitive, such as connecting to a host. Per user
 * since the SSH socket path has no session id. Kept in memory: a restart
 * only means proving it once more.
 */

const verified = new Map<string, number>();

export function recordStepUp(userId: string, now = Date.now()): void {
  verified.set(userId, now);
}

export function stepUpAt(userId: string): number | null {
  return verified.get(userId) ?? null;
}

export function clearStepUp(userId: string): void {
  verified.delete(userId);
}
