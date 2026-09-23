import { authLogger } from "../../utils/logger.js";
import {
  createCurrentAiRepository,
  createCurrentNotificationChannelRepository,
  createCurrentApiKeyRepository,
  createCurrentAuditLogRepository,
  createCurrentC2sTunnelPresetRepository,
  createCurrentCommandHistoryRepository,
  createCurrentCredentialRepository,
  createCurrentDashboardServiceLinkRepository,
  createCurrentDismissedAlertRepository,
  createCurrentHomepageItemRepository,
  createCurrentHomepageLayoutRepository,
  createCurrentHostHealthRepository,
  createCurrentHostFolderRepository,
  createCurrentHostMetricsPreferenceRepository,
  createCurrentHostRepository,
  createCurrentHostSidebarPreferenceRepository,
  createCurrentCredentialSidebarPreferenceRepository,
  createCurrentUiPreferenceRepository,
  createCurrentOpksshTokenRepository,
  createCurrentOpenTabRepository,
  createCurrentRecentActivityRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSessionRepository,
  createCurrentSessionRecordingRepository,
  createCurrentSettingsRepository,
  createCurrentSharedHostSecretsRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentTermixIdentityCaRepository,
  createCurrentTermixIdentityRepository,
  createCurrentTmuxSessionTagRepository,
  createCurrentTrustedDeviceRepository,
  createCurrentUserPreferenceRepository,
  createCurrentUserRepository,
  createCurrentVaultProfileRepository,
  createCurrentSecretSourceRepository,
  createCurrentSharedCredentialSecretsRepository,
  createCurrentCredentialAccessRepository,
  createCurrentVaultTokenRepository,
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

    // Retained rather than deleted: these outlive the account by design.
    // See anonymizeByUserId on each repository.
    await createCurrentSessionRecordingRepository().anonymizeByUserId(userId);

    await createCurrentRbacAccessRepository().deleteHostAccessForUserReferences(
      userId,
    );

    await createCurrentSessionRepository().revokeAllForUser(userId);
    await createCurrentApiKeyRepository().deleteByUserId(userId);
    await createCurrentTrustedDeviceRepository().deleteByUserId(userId);

    await createCurrentRoleRepository().removeAllRolesFromUser(userId);
    await createCurrentAiRepository().deleteByUserId(userId);
    await createCurrentNotificationChannelRepository().deleteByUserId(userId);
    await createCurrentAuditLogRepository().anonymizeByUserId(userId);

    await createCurrentSshCredentialUsageRepository().deleteByUserId(userId);

    // file manager recent/pinned/shortcuts and transfer_recent cascade on the
    // user's refUser() foreign key, as the file-manager plugin's adopted
    // tables.

    await createCurrentRecentActivityRepository().deleteByUserId(userId);
    await createCurrentDismissedAlertRepository().deleteByUserId(userId);

    // snippets, snippet_folders and snippet_access cascade on the user's
    // refUser() foreign key, as the snippets plugin's adopted tables.

    await createCurrentHostFolderRepository().deleteByUserId(userId);

    await createCurrentCommandHistoryRepository().deleteByUserId(userId);

    await createCurrentHostHealthRepository().deleteByUserId(userId);
    await createCurrentHostMetricsPreferenceRepository().deleteByUserId(userId);
    await createCurrentHostSidebarPreferenceRepository().deleteByUserId(userId);
    await createCurrentCredentialSidebarPreferenceRepository().deleteByUserId(
      userId,
    );
    await createCurrentUiPreferenceRepository().deleteByUserId(userId);
    await createCurrentHostRepository().deleteByUserId(userId);
    await createCurrentCredentialRepository().deleteByUserId(userId);

    await createCurrentDashboardServiceLinkRepository().deleteByUserId(userId);
    await createCurrentHomepageItemRepository().deleteByUserId(userId);
    await createCurrentHomepageLayoutRepository().deleteByUserId(userId);
    await createCurrentC2sTunnelPresetRepository().deleteByUserId(userId);
    await createCurrentOpksshTokenRepository().deleteByUserId(userId);
    await createCurrentVaultTokenRepository().deleteByUserId(userId);
    await createCurrentVaultProfileRepository().deleteByUserId(userId);
    await createCurrentSecretSourceRepository().deleteByUserId(userId);
    await createCurrentTermixIdentityCaRepository().deleteByUserId(userId);
    await createCurrentTermixIdentityRepository().deleteByUserId(userId);
    await createCurrentTmuxSessionTagRepository().deleteByUserId(userId);
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
