/**
 * Turning accounts off and on, shared by the admin routes and ctx.users, so
 * both end sessions and guard the last admin the same way.
 */

import { createCurrentUserRepository } from "../database/repositories/factory.js";
import type { UserRecord } from "../database/repositories/user-repository.js";
import { AuthManager } from "../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { PermissionManager } from "../utils/permission-manager.js";

export type AccountErrorCode =
  "not_found" | "last_admin" | "username_taken" | "email_taken" | "invalid";

/** A refused account change, with a code callers can branch on. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code: AccountErrorCode,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * Turns an account off: it is signed out everywhere and can't sign in. The
 * last admin who is still on can't be turned off. Returns false when the
 * account was already off.
 */
export async function disableAccount(
  target: UserRecord,
  reason: string,
): Promise<boolean> {
  if (target.disabledAt) return false;
  const users = createCurrentUserRepository();
  if (target.isAdmin && (await users.countAdmins()) <= 1) {
    throw new AccountError("You can't turn off the last admin", "last_admin");
  }
  await users.update(target.id, {
    disabledAt: new Date().toISOString(),
    disabledReason: reason,
  });
  PermissionManager.getInstance().invalidateUserPermissionCache(target.id);
  await AuthManager.getInstance().revokeAllUserSessions(target.id);
  await DatabaseSaveTrigger.forceSave("disable_user").catch(() => {});
  return true;
}

/** Turns an account back on. Returns false when it was already on. */
export async function enableAccount(target: UserRecord): Promise<boolean> {
  if (!target.disabledAt) return false;
  await createCurrentUserRepository().update(target.id, {
    disabledAt: null,
    disabledReason: null,
  });
  PermissionManager.getInstance().invalidateUserPermissionCache(target.id);
  await DatabaseSaveTrigger.forceSave("enable_user").catch(() => {});
  return true;
}
