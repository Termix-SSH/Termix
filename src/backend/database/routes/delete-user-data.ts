import { authLogger } from "../../utils/logger.js";
import { createCurrentApiKeyRepository } from "../repositories/current-api-key-repository.js";
import { createCurrentAuditLogRepository } from "../repositories/current-audit-log-repository.js";
import { createCurrentC2sTunnelPresetRepository } from "../repositories/current-c2s-tunnel-preset-repository.js";
import { createCurrentCommandHistoryRepository } from "../repositories/current-command-history-repository.js";
import { createCurrentCredentialRepository } from "../repositories/current-credential-repository.js";
import { createCurrentDashboardServiceLinkRepository } from "../repositories/current-dashboard-service-link-repository.js";
import { createCurrentDismissedAlertRepository } from "../repositories/current-dismissed-alert-repository.js";
import { createCurrentFileManagerBookmarkRepository } from "../repositories/current-file-manager-bookmark-repository.js";
import { createCurrentHomepageItemRepository } from "../repositories/current-homepage-item-repository.js";
import { createCurrentHomepageLayoutRepository } from "../repositories/current-homepage-layout-repository.js";
import { createCurrentHostHealthRepository } from "../repositories/current-host-health-repository.js";
import { createCurrentHostFolderRepository } from "../repositories/current-host-folder-repository.js";
import { createCurrentHostMetricsPreferenceRepository } from "../repositories/current-host-metrics-preference-repository.js";
import { createCurrentHostRepository } from "../repositories/current-host-repository.js";
import { createCurrentNetworkTopologyRepository } from "../repositories/current-network-topology-repository.js";
import { createCurrentOpksshTokenRepository } from "../repositories/current-opkssh-token-repository.js";
import { createCurrentOpenTabRepository } from "../repositories/current-open-tab-repository.js";
import { createCurrentRecentActivityRepository } from "../repositories/current-recent-activity-repository.js";
import { createCurrentRbacAccessRepository } from "../repositories/current-rbac-access-repository.js";
import { createCurrentRoleRepository } from "../repositories/current-role-repository.js";
import { createCurrentSessionRepository } from "../repositories/current-session-repository.js";
import { createCurrentSessionRecordingRepository } from "../repositories/current-session-recording-repository.js";
import { createCurrentSettingsRepository } from "../repositories/current-settings-repository.js";
import { createCurrentSharedCredentialRepository } from "../repositories/current-shared-credential-repository.js";
import { createCurrentSnippetRepository } from "../repositories/current-snippet-repository.js";
import { createCurrentSshCredentialUsageRepository } from "../repositories/current-ssh-credential-usage-repository.js";
import { createCurrentTrustedDeviceRepository } from "../repositories/current-trusted-device-repository.js";
import { createCurrentUserPreferenceRepository } from "../repositories/current-user-preference-repository.js";
import { createCurrentUserRepository } from "../repositories/current-user-repository.js";
import { createCurrentTransferRecentRepository } from "../repositories/current-transfer-recent-repository.js";
import { createCurrentVaultProfileRepository } from "../repositories/current-vault-profile-repository.js";
import { createCurrentVaultTokenRepository } from "../repositories/current-vault-token-repository.js";

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
