import axios from "axios";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { authApi, getServerConfig, handleApiError } from "@/main-axios";

export interface ResolvedShareLink {
  protocol: "ssh" | "rdp" | "vnc" | "telnet";
  permissionLevel: "read-only" | "read-write";
  wsPath: string;
  connectParams?: { token: string };
}

export type ShareLinkErrorKind = "not-found" | "rate-limited" | "unknown";

export class ShareLinkError extends Error {
  constructor(
    message: string,
    public readonly kind: ShareLinkErrorKind,
  ) {
    super(message);
    this.name = "ShareLinkError";
  }
}

const isDev = (): boolean =>
  !isElectron() &&
  process.env.NODE_ENV === "development" &&
  (window.location.port === "3000" ||
    window.location.port === "5173" ||
    window.location.port === "");

// Guests have no session/JWT, so this deliberately builds a bare base URL
// rather than going through main-axios's authenticated instances.
async function resolveApiBaseUrl(): Promise<string> {
  if (isDev()) {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    return `${protocol}://localhost:30001`;
  }
  if (isElectron()) {
    const serverConfig = await getServerConfig();
    const configuredUrl = serverConfig?.serverUrl;
    if (configuredUrl) return configuredUrl.replace(/\/$/, "");
    return "http://localhost:30001";
  }
  return getBasePath();
}

export async function resolveShareLink(
  linkToken: string,
): Promise<ResolvedShareLink> {
  const baseUrl = await resolveApiBaseUrl();
  try {
    const response = await axios.get(
      `${baseUrl}/session-sharing/resolve/${encodeURIComponent(linkToken)}`,
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        throw new ShareLinkError(
          "Share link is invalid, expired, or revoked",
          "not-found",
        );
      }
      if (error.response?.status === 429) {
        throw new ShareLinkError(
          "Too many attempts, please try again shortly",
          "rate-limited",
        );
      }
    }
    throw new ShareLinkError("Failed to resolve share link", "unknown");
  }
}

// ============================================================================
// SESSION SHARING (authenticated owner-side API)
// ============================================================================

export type SessionShareProtocol = "ssh" | "rdp" | "vnc" | "telnet";
export type SessionShareType = "link" | "user";
export type SessionSharePermissionLevel = "read-only" | "read-write";

export interface SessionShareRecord {
  id: string;
  hostId: number;
  ownerUserId: string;
  protocol: SessionShareProtocol;
  sessionId: string;
  tabInstanceId: string | null;
  shareType: SessionShareType;
  targetUserId: string | null;
  linkToken: string | null;
  permissionLevel: SessionSharePermissionLevel;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastJoinedAt: string | null;
  joinCount: number;
}

export interface CreateSessionShareRequest {
  hostId: number;
  sessionId: string;
  tabInstanceId?: string;
  protocol: SessionShareProtocol;
  shareType: SessionShareType;
  targetUserId?: string;
  permissionLevel: SessionSharePermissionLevel;
  expiryHours?: number;
}

export interface CreateSessionShareResponse {
  shareId: string;
  linkToken: string | null;
  expiresAt: string;
}

export async function createSessionShare(
  request: CreateSessionShareRequest,
): Promise<CreateSessionShareResponse> {
  try {
    const response = await authApi.post("/session-sharing/create", request);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create session share");
  }
}

export async function getActiveSessionShares(
  hostId: number,
): Promise<{ shares: SessionShareRecord[] }> {
  try {
    const response = await authApi.get(
      `/session-sharing/host/${hostId}/active`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch active session shares");
  }
}

export async function revokeSessionShare(
  shareId: string,
): Promise<{ success: true }> {
  try {
    const response = await authApi.delete(`/session-sharing/${shareId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke session share");
  }
}

export async function endSessionShareSession(
  shareId: string,
): Promise<{ success: true }> {
  try {
    const response = await authApi.post(`/session-sharing/${shareId}/end`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "end shared session");
  }
}

// ============================================================================
// GLOBAL ADMIN TOGGLE
// ============================================================================

export async function getSessionSharingGloballyEnabled(): Promise<{
  enabled: boolean;
}> {
  try {
    const response = await authApi.get("/users/session-sharing-enabled");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch session sharing enabled setting");
  }
}

export async function updateSessionSharingGloballyEnabled(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.patch("/users/session-sharing-enabled", {
      enabled,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update session sharing enabled setting");
  }
}
