import { PermissionManager } from "../utils/permission-manager.js";
import { AuthManager } from "../utils/auth-manager.js";

/**
 * Run after a user's admin flag changes. Drops cached permissions so the
 * change applies on the next request, and on demotion ends every session the
 * user has, so nothing opened as admin keeps running.
 */
export async function afterAdminStatusChange(
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  PermissionManager.getInstance().invalidateUserPermissionCache(userId);
  if (!isAdmin) {
    await AuthManager.getInstance().revokeAllUserSessions(userId);
  }
}
