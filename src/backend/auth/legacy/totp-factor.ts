/**
 * TOTP as a second factor. Enrolment stays in the TOTP routes; this is the
 * login half. Phase C moves both into the TOTP plugin.
 */

import speakeasy from "speakeasy";
import { AuthManager } from "../../utils/auth-manager.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import {
  createCurrentUserAuthRepository,
  createCurrentUserRepository,
} from "../../database/repositories/factory.js";
import type { SecondFactor } from "../registry.js";

export const TOTP_FACTOR_ID = "totp";

/**
 * Checks a backup code and burns it. Codes are stored encrypted under the
 * user's data key when it was available at enrolment, so both forms are read.
 */
async function consumeBackupCode(
  userId: string,
  storedCodes: string | null,
  code: string,
  userDataKey: Buffer,
): Promise<boolean> {
  if (!storedCodes) return false;
  const raw = LazyFieldEncryption.safeGetFieldValue(
    storedCodes,
    userDataKey,
    userId,
    "totpBackupCodes",
  );
  let codes: unknown = [];
  try {
    codes = raw ? JSON.parse(raw) : [];
  } catch {
    codes = [];
  }
  if (!Array.isArray(codes)) return false;
  const index = codes.indexOf(code);
  if (index === -1) return false;

  codes.splice(index, 1);
  await createCurrentUserRepository().update(userId, {
    totpBackupCodes: FieldCrypto.encryptField(
      JSON.stringify(codes),
      userDataKey,
      userId,
      "totpBackupCodes",
    ),
  });
  return true;
}

export const totpSecondFactor: SecondFactor = {
  id: TOTP_FACTOR_ID,
  pluginId: "core",
  labelKey: "auth.totpFactor",

  isEnrolled: async (userId) => {
    const user = await createCurrentUserRepository().findById(userId);
    return !!user?.totpEnabled;
  },

  verify: async (userId, body) => {
    const code = String(body.totp_code ?? body.code ?? "").trim();
    if (!code) return false;

    const user = await createCurrentUserRepository().findById(userId);
    if (!user?.totpEnabled || !user.totpSecret) {
      return { ok: false, error: "TOTP not enabled for this user" };
    }

    const userDataKey = AuthManager.getInstance().getUserDataKey(userId);
    if (!userDataKey) {
      return {
        ok: false,
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      };
    }

    const secret = LazyFieldEncryption.safeGetFieldValue(
      user.totpSecret,
      userDataKey,
      userId,
      "totp_secret",
    );
    if (!secret) {
      // The secret was encrypted under a key a password reset replaced.
      await createCurrentUserRepository().update(userId, {
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: null,
      });
      await createCurrentUserAuthRepository().removeSecondFactor(
        userId,
        "core",
        TOTP_FACTOR_ID,
      );
      return {
        ok: false,
        error:
          "TOTP has been disabled due to password reset. Please set up TOTP again.",
      };
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: code,
      window: 2,
    });
    if (verified) return true;

    return consumeBackupCode(userId, user.totpBackupCodes, code, userDataKey);
  },

  reset: async (userId) => {
    await createCurrentUserRepository().update(userId, {
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: null,
    });
  },
};
