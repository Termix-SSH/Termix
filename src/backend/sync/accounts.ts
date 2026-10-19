/**
 * Accounts on a desktop. Each local user is one account: the plain local one,
 * or the replica of a linked server. Exactly one is active, and the app signs
 * in as it. Switching only changes which user the desktop auto session picks,
 * so no data is shared between accounts.
 */

import crypto from "crypto";
import {
  createCurrentRoleRepository,
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { resolveDesktopAutoSessionUser } from "../database/routes/desktop-auto-session.js";
import { AuthManager } from "../utils/auth-manager.js";

const ACTIVE_KEY = "desktop_active_user";

/** The user the desktop signs in as. Falls back to the usual single-user pick. */
export async function getActiveUserId(): Promise<string | null> {
  const users = await createCurrentUserRepository().listAll();
  if (users.length === 0) return null;
  const saved = await createCurrentSettingsRepository().get(ACTIVE_KEY);
  return resolveDesktopAutoSessionUser(users, saved)?.id ?? null;
}

export async function setActiveUserId(userId: string): Promise<void> {
  const user = await createCurrentUserRepository().findById(userId);
  if (!user) throw new Error("No such account");
  await createCurrentSettingsRepository().set(ACTIVE_KEY, userId);
}

/** Saved choice only, for the auto session route. */
export async function getSavedActiveUserId(): Promise<string | null> {
  return createCurrentSettingsRepository().get(ACTIVE_KEY);
}

export interface DesktopAccount {
  id: string;
  username: string;
  isAdmin: boolean;
  active: boolean;
}

export async function listAccounts(): Promise<DesktopAccount[]> {
  const users = await createCurrentUserRepository().listAll();
  const active = await getActiveUserId();
  return users.map((user) => ({
    id: user.id,
    username: user.username,
    isAdmin: !!user.isAdmin,
    active: user.id === active,
  }));
}

/** A new empty account for another server to be linked to. */
export async function createAccount(): Promise<string> {
  const users = createCurrentUserRepository();
  const id = crypto.randomUUID();
  await users.create({
    id,
    username: `server-${id.slice(0, 8)}`,
    passwordHash: "",
    isAdmin: true,
  });
  try {
    await createCurrentRoleRepository().assignRoleNameToUser({
      userId: id,
      roleName: "admin",
      grantedBy: id,
    });
  } catch {
    // The account still works; admin is also set on the user row.
  }
  await AuthManager.getInstance().registerUser(
    id,
    crypto.randomBytes(32).toString("hex"),
  );
  return id;
}

/** Deletes an account and everything it owns. The last account stays. */
export async function removeAccount(userId: string): Promise<void> {
  const users = await createCurrentUserRepository().listAll();
  if (users.length <= 1) throw new Error("The last account cannot be removed");
  const active = await getActiveUserId();
  const { deleteUserAndRelatedData } =
    await import("../database/routes/delete-user-data.js");
  await deleteUserAndRelatedData(userId);
  if (active === userId) {
    const next = users.find((user) => user.id !== userId);
    if (next) await setActiveUserId(next.id);
  }
}
