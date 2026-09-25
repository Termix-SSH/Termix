import { authLogger } from "../../utils/logger.js";
import {
  createCurrentApiKeyRepository,
  createCurrentAuditLogRepository,
  createCurrentCredentialRepository,
  createCurrentHostFolderRepository,
  createCurrentHostRepository,
  createCurrentHostSidebarPreferenceRepository,
  createCurrentCredentialSidebarPreferenceRepository,
  createCurrentUiPreferenceRepository,
  createCurrentOpenTabRepository,
  createCurrentRecentActivityRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSessionRepository,
  createCurrentSettingsRepository,
  createCurrentSharedHostSecretsRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentTrustedDeviceRepository,
  createCurrentUserPreferenceRepository,
  createCurrentUserRepository,
  createCurrentSharedCredentialSecretsRepository,
  createCurrentCredentialAccessRepository,
} from "../repositories/factory.js";

export async function deleteUserAndRelatedData(
  userId: string,
  options: { successorUserId?: string } = {},
): Promise<void> {
  try {
    // With a successor, hosts and credentials (and the shares on them)
    // change owner instead of disappearing with the account.
    if (options.successorUserId) {
      const { transferOwnership } =
        await import("../../utils/transfer-ownership.js");
      await transferOwnership(userId, options.successorUserId);
    }

    await createCurrentSharedHostSecretsRepository().deleteByTargetUserId(
      userId,
    );
    await createCurrentSharedCredentialSecretsRepository().deleteByTargetUserId(
      userId,
    );
    await createCurrentCredentialAccessRepository().deleteForUserReferences(
      userId,
    );

    // Plugins drop or anonymize their own rows on user.deleted, or rely on
    // their refUser() foreign keys cascading.
    const { pluginEvents, TOPICS } = await import("../../plugins/events.js");
    pluginEvents.emit(TOPICS.userDeleted, { userId });

    await createCurrentRbacAccessRepository().deleteHostAccessForUserReferences(
      userId,
    );

    await createCurrentSessionRepository().revokeAllForUser(userId);
    await createCurrentApiKeyRepository().deleteByUserId(userId);
    await createCurrentTrustedDeviceRepository().deleteByUserId(userId);

    await createCurrentRoleRepository().removeAllRolesFromUser(userId);
    await createCurrentAuditLogRepository().anonymizeByUserId(userId);

    await createCurrentSshCredentialUsageRepository().deleteByUserId(userId);

    await createCurrentRecentActivityRepository().deleteByUserId(userId);

    await createCurrentHostFolderRepository().deleteByUserId(userId);

    await createCurrentHostSidebarPreferenceRepository().deleteByUserId(userId);
    await createCurrentCredentialSidebarPreferenceRepository().deleteByUserId(
      userId,
    );
    await createCurrentUiPreferenceRepository().deleteByUserId(userId);
    await createCurrentHostRepository().deleteByUserId(userId);
    await createCurrentCredentialRepository().deleteByUserId(userId);

    // Plugin tables with a refUser() column cascade on the user row.

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
