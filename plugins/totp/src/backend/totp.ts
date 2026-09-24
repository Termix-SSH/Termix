import crypto from "node:crypto";
import speakeasy from "speakeasy";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { EnrollmentRepository } from "./repository.js";

export const FACTOR_ID = "totp";

const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BACKUP_CODE_COUNT = 8;

/** Eight characters from a CSPRNG; Math.random is not fit for secrets. */
export function generateBackupCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += BACKUP_CODE_ALPHABET[crypto.randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return code;
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token: code,
    window: 2,
  });
}

export function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export type TotpService = ReturnType<typeof createTotpService>;

/**
 * Reads and checks a user's enrolment. Secrets are sealed with the
 * installation key, so this works during login with no acting user.
 */
export function createTotpService(
  ctx: PluginContext,
  repository: EnrollmentRepository,
) {
  const unseal = (value: string | null) =>
    value ? ctx.secrets.unseal(value) : Promise.resolve(null);

  async function readBackupCodes(sealed: string | null): Promise<string[]> {
    const raw = await unseal(sealed);
    if (!raw) return [];
    try {
      const codes = JSON.parse(raw);
      return Array.isArray(codes) ? codes : [];
    } catch {
      return [];
    }
  }

  async function sealBackupCodes(codes: string[]): Promise<string> {
    return ctx.secrets.seal(JSON.stringify(codes));
  }

  return {
    async isEnrolled(userId: string): Promise<boolean> {
      return !!(await repository.find(userId))?.secret;
    },

    /** The active secret, or null when not enrolled or unreadable. */
    async activeSecret(userId: string): Promise<string | null> {
      return unseal((await repository.find(userId))?.secret ?? null);
    },

    /**
     * True for a current code from the authenticator or an unused backup
     * code, which is burnt. Null when the user has no readable secret.
     */
    async checkCode(userId: string, code: string): Promise<boolean | null> {
      const row = await repository.find(userId);
      const secret = await unseal(row?.secret ?? null);
      if (!row || !secret) return null;
      if (!code) return false;
      if (verifyTotpCode(secret, code)) return true;

      const codes = await readBackupCodes(row.backupCodes);
      const index = codes.indexOf(code);
      if (index === -1) return false;
      codes.splice(index, 1);
      await repository.save(userId, {
        backupCodes: await sealBackupCodes(codes),
      });
      return true;
    },

    /** Starts setup with a new secret, replacing any unfinished one. */
    async startSetup(userId: string, label: string) {
      const secret = speakeasy.generateSecret({ name: label, length: 32 });
      await repository.save(userId, {
        pendingSecret: await ctx.secrets.seal(secret.base32),
      });
      return { secret: secret.base32, otpauthUrl: secret.otpauth_url ?? "" };
    },

    /** The unfinished setup's secret, when a code from it verifies. */
    async pendingSecretFor(userId: string, code: string) {
      const pending = await unseal(
        (await repository.find(userId))?.pendingSecret ?? null,
      );
      if (!pending) return { status: "not-started" as const };
      if (!verifyTotpCode(pending, code)) return { status: "invalid" as const };
      return { status: "ok" as const, secret: pending };
    },

    /** Makes the verified pending secret active and issues backup codes. */
    async activate(userId: string, secret: string): Promise<string[]> {
      const codes = generateBackupCodes();
      await repository.save(userId, {
        secret: await ctx.secrets.seal(secret),
        pendingSecret: null,
        backupCodes: await sealBackupCodes(codes),
      });
      return codes;
    },

    async replaceBackupCodes(userId: string): Promise<string[]> {
      const codes = generateBackupCodes();
      await repository.save(userId, {
        backupCodes: await sealBackupCodes(codes),
      });
      return codes;
    },

    remove: (userId: string) => repository.remove(userId),
  };
}
