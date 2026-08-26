import { randomInt } from "node:crypto";

/**
 * Alphabet for TOTP backup codes. Kept to [0-9A-Z] so the codes look and
 * behave exactly like the ones this app has always issued (8 uppercase
 * alphanumerics) - only the source of randomness changes.
 */
const BACKUP_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const BACKUP_CODE_LENGTH = 8;
export const BACKUP_CODE_COUNT = 8;

/**
 * Backup codes are a full second-factor bypass, so they must come from a
 * CSPRNG. `Math.random()` is seeded per-process and its internal xorshift128+
 * state is recoverable from a handful of outputs, which means one leaked code
 * would expose the other seven generated in the same call - and a code is not
 * always 8 characters long either, because `toString(36)` drops trailing
 * zeroes.
 */
export function generateBackupCode(
  length: number = BACKUP_CODE_LENGTH,
): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return code;
}

export function generateBackupCodes(
  count: number = BACKUP_CODE_COUNT,
): string[] {
  return Array.from({ length: count }, () => generateBackupCode());
}
