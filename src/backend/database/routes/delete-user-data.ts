import { authLogger } from "../../utils/logger.js";
import {
  createCurrentAlertRepository,
  createCurrentApiKeyRepository,
  createCurrentAuditLogRepository,
  createCurrentC2sTunnelPresetRepository,
  createCurrentCommandHistoryRepository,
  createCurrentCredentialRepository,
  createCurrentDashboardServiceLinkRepository,
  createCurrentDismissedAlertRepository,
  createCurrentFileManagerBookmarkRepository,
  createCurrentHomepageItemRepository,
  createCurrentHomepageLayoutRepository,
  createCurrentHostHealthRepository,
  createCurrentHostFolderRepository,
  createCurrentHostMetricsPreferenceRepository,
  createCurrentHostRepository,
  createCurrentNetworkTopologyRepository,
  createCurrentOpksshTokenRepository,
  createCurrentOpenTabRepository,
  createCurrentRecentActivityRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSessionRepository,
  createCurrentSessionRecordingRepository,
  createCurrentSettingsRepository,
  createCurrentSharedCredentialRepository,
  createCurrentSnippetRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentTermixIdentityCaRepository,
  createCurrentTermixIdentityRepository,
  createCurrentTmuxSessionTagRepository,
  createCurrentTrustedDeviceRepository,
  createCurrentUserPreferenceRepository,
  createCurrentUserRepository,
  createCurrentTransferRecentRepository,
  createCurrentVaultProfileRepository,
  createCurrentVaultTokenRepository,
} from "../repositories/factory.js";

export async function deleteUserAndRelatedData(userId: string): Promise<void> {
  try {
    await createCurrentSharedCredentialRepository().deleteByTargetUserId(
      userId,
    );

    await createCurrentSessionRecordingRepository().deleteByUserId(userId);

    await createCurrentRbacAccessRepository().deleteHostAccessForUserReferences(
      userId,
    );

    await createCurrentSessionRepository().revokeAllForUser(userId);
    await createCurrentApiKeyRepository().deleteByUserId(userId);
    await createCurrentTrustedDeviceRepository().deleteByUserId(userId);

    await createCurrentRoleRepository().removeAllRolesFromUser(userId);
    await createCurrentAlertRepository().deleteByUserId(userId);
    await createCurrentAuditLogRepository().deleteByUserId(userId);

    await createCurrentSshCredentialUsageRepository().deleteByUserId(userId);

    await createCurrentFileManagerBookmarkRepository().deleteByUserId(userId);

    await createCurrentTransferRecentRepository().deleteByUserId(userId);

    await createCurrentRecentActivityRepository().deleteByUserId(userId);
    await createCurrentDismissedAlertRepository().deleteByUserId(userId);

    await createCurrentSnippetRepository().deleteByUserId(userId);

    await createCurrentHostFolderRepository().deleteByUserId(userId);

    await createCurrentCommandHistoryRepository().deleteByUserId(userId);

    await createCurrentHostHealthRepository().deleteByUserId(userId);
    await createCurrentHostMetricsPreferenceRepository().deleteByUserId(userId);
    await createCurrentHostRepository().deleteByUserId(userId);
    await createCurrentCredentialRepository().deleteByUserId(userId);

    await createCurrentNetworkTopologyRepository().deleteByUserId(userId);
    await createCurrentDashboardServiceLinkRepository().deleteByUserId(userId);
    await createCurrentHomepageItemRepository().deleteByUserId(userId);
    await createCurrentHomepageLayoutRepository().deleteByUserId(userId);
    await createCurrentC2sTunnelPresetRepository().deleteByUserId(userId);
    await createCurrentOpksshTokenRepository().deleteByUserId(userId);
    await createCurrentVaultTokenRepository().deleteByUserId(userId);
    await createCurrentVaultProfileRepository().deleteByUserId(userId);
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
