import { sessionManager } from "../terminal/session-manager.js";
import { getGuacSessionInfo } from "../guacamole/guacamole-server.js";
import {
  createCurrentHostResolutionRepository,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";

export type LiveProtocol = "ssh" | "rdp" | "vnc" | "telnet";

export async function isSharingEnabledForHost(hostId: number): Promise<{
  enabled: boolean;
  hostOwnerId: string | null;
}> {
  const globalEnabled = await createCurrentSettingsRepository().getBoolean(
    "session_sharing_globally_enabled",
    true,
  );
  if (!globalEnabled) return { enabled: false, hostOwnerId: null };

  const hostResolutionRepository = createCurrentHostResolutionRepository();
  const hostOwnerId = await hostResolutionRepository.findHostOwnerId(hostId);
  if (!hostOwnerId) return { enabled: false, hostOwnerId: null };

  const host = await hostResolutionRepository.findHostById(hostId, hostOwnerId);
  if (!host) return { enabled: false, hostOwnerId: null };

  return {
    enabled: host.allowSessionSharing !== false,
    hostOwnerId,
  };
}

export function isLiveSessionOwnedBy(
  protocol: LiveProtocol,
  sessionId: string,
  userId: string,
): boolean {
  if (protocol === "ssh") {
    const session = sessionManager.getSession(sessionId);
    return !!session && session.isConnected && session.userId === userId;
  }
  const info = getGuacSessionInfo(sessionId);
  return !!info && info.ownerUserId === userId;
}

export function isLiveSession(
  protocol: LiveProtocol,
  sessionId: string,
): boolean {
  if (protocol === "ssh") {
    const session = sessionManager.getSession(sessionId);
    return !!session && session.isConnected;
  }
  return !!getGuacSessionInfo(sessionId);
}
