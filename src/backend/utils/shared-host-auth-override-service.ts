import {
  AUTH_PROTOCOL_METADATA,
  isSupportedAuthOverrideProtocol,
  type AuthOverrideProtocol,
} from "../../types/auth-protocols.js";
import {
  createCurrentCredentialRepository,
  createCurrentSharedHostAuthOverrideRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { logAudit } from "./audit-logger.js";
import { PermissionManager } from "./permission-manager.js";

export interface SharedHostAuthOverrideAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

export class SharedHostAuthOverrideServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "SharedHostAuthOverrideServiceError";
  }
}

export class SharedHostAuthOverrideService {
  private static instance: SharedHostAuthOverrideService;

  private constructor() {}

  static getInstance(): SharedHostAuthOverrideService {
    if (!this.instance) {
      this.instance = new SharedHostAuthOverrideService();
    }
    return this.instance;
  }

  async getCredentialId(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
  ): Promise<number | null> {
    this.requireSupportedProtocol(protocol);
    await this.requireSharedHostAccess(hostId, userId);
    return createCurrentSharedHostAuthOverrideRepository().findCredentialId(
      hostId,
      userId,
      protocol,
    );
  }

  async setCredentialId(
    hostId: number,
    userId: string,
    protocol: AuthOverrideProtocol,
    credentialId: number | null,
    auditContext: SharedHostAuthOverrideAuditContext = {},
  ): Promise<void> {
    this.requireSupportedProtocol(protocol);
    await this.requireSharedHostAccess(hostId, userId);

    if (credentialId !== null) {
      const credential =
        await createCurrentCredentialRepository().findByIdForUser(
          userId,
          credentialId,
        );
      if (!credential) {
        throw new SharedHostAuthOverrideServiceError(
          "Credential not found",
          404,
        );
      }
    }

    const repository = createCurrentSharedHostAuthOverrideRepository();
    if (credentialId === null) {
      await repository.clearCredential(hostId, userId, protocol);
    } else {
      await repository.setCredential(hostId, userId, protocol, credentialId);
    }

    try {
      const actor = await createCurrentUserRepository().findById(userId);
      await logAudit({
        userId,
        username: actor?.username ?? userId,
        action:
          credentialId === null
            ? "clear_shared_host_auth_override"
            : "set_shared_host_auth_override",
        resourceType: "host",
        resourceId: String(hostId),
        details: JSON.stringify({
          protocol,
          credentialId,
        }),
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        success: true,
      });
    } catch {
      // Audit bookkeeping must never turn a successful override write into a
      // failed API response.
    }
  }

  private requireSupportedProtocol(protocol: AuthOverrideProtocol): void {
    if (!isSupportedAuthOverrideProtocol(protocol)) {
      throw new SharedHostAuthOverrideServiceError(
        `${AUTH_PROTOCOL_METADATA[protocol].label} authentication overrides are not supported yet`,
        400,
      );
    }
  }

  private async requireSharedHostAccess(
    hostId: number,
    userId: string,
  ): Promise<void> {
    const access = await PermissionManager.getInstance().canAccessHost(
      userId,
      hostId,
      "connect",
    );
    if (!access.hasAccess || !access.isShared || access.isAdminBypass) {
      throw new SharedHostAuthOverrideServiceError(
        "Authentication overrides require active shared host access",
        403,
      );
    }
  }
}
