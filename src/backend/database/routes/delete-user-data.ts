import { eq } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { createCurrentAuditLogRepository } from "../repositories/current-audit-log-repository.js";
import { createCurrentCommandHistoryRepository } from "../repositories/current-command-history-repository.js";
import { createCurrentDismissedAlertRepository } from "../repositories/current-dismissed-alert-repository.js";
import { createCurrentNetworkTopologyRepository } from "../repositories/current-network-topology-repository.js";
import { createCurrentOpenTabRepository } from "../repositories/current-open-tab-repository.js";
import { createCurrentRecentActivityRepository } from "../repositories/current-recent-activity-repository.js";
import { createCurrentRbacAccessRepository } from "../repositories/current-rbac-access-repository.js";
import { createCurrentRoleRepository } from "../repositories/current-role-repository.js";
import { createCurrentSessionRepository } from "../repositories/current-session-repository.js";
import { createCurrentSettingsRepository } from "../repositories/current-settings-repository.js";
import { createCurrentSshCredentialUsageRepository } from "../repositories/current-ssh-credential-usage-repository.js";
import { createCurrentUserPreferenceRepository } from "../repositories/current-user-preference-repository.js";
import { createCurrentUserRepository } from "../repositories/current-user-repository.js";
import {
  fileManagerPinned,
  fileManagerRecent,
  fileManagerShortcuts,
  hosts,
  opksshTokens,
  sessionRecordings,
  sharedCredentials,
  snippetFolders,
  snippets,
  sshCredentials,
  sshFolders,
  transferRecent,
} from "../db/schema.js";

export async function deleteUserAndRelatedData(userId: string): Promise<void> {
  try {
    await db
      .delete(sharedCredentials)
      .where(eq(sharedCredentials.targetUserId, userId));

    await db
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.userId, userId));

    await createCurrentRbacAccessRepository().deleteHostAccessForUserReferences(
      userId,
    );

    await createCurrentSessionRepository().revokeAllForUser(userId);

    await createCurrentRoleRepository().removeAllRolesFromUser(userId);
    await createCurrentAuditLogRepository().deleteByUserId(userId);

    await createCurrentSshCredentialUsageRepository().deleteByUserId(userId);

    await db
      .delete(fileManagerRecent)
      .where(eq(fileManagerRecent.userId, userId));
    await db
      .delete(fileManagerPinned)
      .where(eq(fileManagerPinned.userId, userId));
    await db
      .delete(fileManagerShortcuts)
      .where(eq(fileManagerShortcuts.userId, userId));

    await db.delete(transferRecent).where(eq(transferRecent.userId, userId));

    await createCurrentRecentActivityRepository().deleteByUserId(userId);
    await createCurrentDismissedAlertRepository().deleteByUserId(userId);

    await db.delete(snippets).where(eq(snippets.userId, userId));
    await db.delete(snippetFolders).where(eq(snippetFolders.userId, userId));

    await db.delete(sshFolders).where(eq(sshFolders.userId, userId));

    await createCurrentCommandHistoryRepository().deleteByUserId(userId);

    await db.delete(hosts).where(eq(hosts.userId, userId));
    await db.delete(sshCredentials).where(eq(sshCredentials.userId, userId));

    await createCurrentNetworkTopologyRepository().deleteByUserId(userId);
    await db.delete(opksshTokens).where(eq(opksshTokens.userId, userId));
    await createCurrentOpenTabRepository().deleteByUserId(userId);
    await createCurrentUserPreferenceRepository().deleteByUserId(userId);

    await createCurrentSettingsRepository().deleteLike(`user_%_${userId}`);

    await createCurrentUserRepository().delete(userId);

    authLogger.success("User and all related data deleted successfully", {
      operation: "delete_user_and_related_data_complete",
      userId,
    });
  } catch (error) {
    authLogger.error("Failed to delete user and related data", error, {
      operation: "delete_user_and_related_data_failed",
      userId,
    });
    throw error;
  }
}
