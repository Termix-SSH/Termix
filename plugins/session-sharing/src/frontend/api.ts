import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

/**
 * The plugin's own /plugin-api/session-sharing client, bound in activate.
 * Guest pages use it too: the two guest routes are public.
 */
let client: PluginApiClient | null = null;
let clientFor: ((origin?: unknown) => PluginApiClient) | null = null;

export function bindApi(
  api: PluginApiClient | null,
  apiFor?: (origin?: unknown) => PluginApiClient,
): void {
  client = api;
  clientFor = api ? (apiFor ?? null) : null;
}

/** The session lives on the backend its tab connected through. */
function api(origin?: SessionOrigin): PluginApiClient {
  if (!client) throw new Error("Session sharing is not running");
  return origin && clientFor ? clientFor(origin) : client;
}

export type SessionOrigin = "local" | "remote";

interface HttpError {
  response?: { status?: number; data?: { error?: string } };
}

function statusOf(error: unknown): number | undefined {
  return (error as HttpError)?.response?.status;
}

/** The server's own message, like core's handleApiError. */
function apiError(error: unknown, fallback: string): Error {
  const message = (error as HttpError)?.response?.data?.error;
  return new Error(message || fallback);
}

async function call<T>(
  request: () => Promise<{ data: T }>,
  fallback: string,
): Promise<T> {
  try {
    return (await request()).data;
  } catch (error) {
    throw apiError(error, fallback);
  }
}

// ---------------------------------------------------------------------------
// Guest share links
// ---------------------------------------------------------------------------

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

export async function resolveShareLink(
  linkToken: string,
): Promise<ResolvedShareLink> {
  try {
    const response = await api().get<ResolvedShareLink>(
      `/resolve/${encodeURIComponent(linkToken)}`,
    );
    return response.data;
  } catch (error) {
    const status = statusOf(error);
    if (status === 404) {
      throw new ShareLinkError(
        "Share link is invalid, expired, or revoked",
        "not-found",
      );
    }
    if (status === 429) {
      throw new ShareLinkError(
        "Too many attempts, please try again shortly",
        "rate-limited",
      );
    }
    throw new ShareLinkError("Failed to resolve share link", "unknown");
  }
}

// ---------------------------------------------------------------------------
// Owner-side shares
// ---------------------------------------------------------------------------

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

export function createSessionShare(
  request: CreateSessionShareRequest,
  origin?: SessionOrigin,
): Promise<CreateSessionShareResponse> {
  return call(
    () => api(origin).post<CreateSessionShareResponse>("/create", request),
    "Failed to create session share",
  );
}

export function getActiveSessionShares(
  hostId: number,
  origin?: SessionOrigin,
): Promise<{ shares: SessionShareRecord[] }> {
  return call(
    () =>
      api(origin).get<{ shares: SessionShareRecord[] }>(
        `/host/${hostId}/active`,
      ),
    "Failed to fetch active session shares",
  );
}

export function revokeSessionShare(
  shareId: string,
  origin?: SessionOrigin,
): Promise<unknown> {
  return call(
    () => api(origin).delete(`/${encodeURIComponent(shareId)}`),
    "Failed to revoke session share",
  );
}

export interface DirectoryUser {
  id: string;
  username: string;
}

export interface DirectoryRole {
  id: number;
  name: string;
  displayName: string | null;
}

/** Users and roles to share with or invite. */
export function getDirectory(origin?: SessionOrigin): Promise<{
  users: DirectoryUser[];
  roles: DirectoryRole[];
}> {
  return call(
    () =>
      api(origin).get<{ users: DirectoryUser[]; roles: DirectoryRole[] }>(
        "/directory",
      ),
    "Failed to list users and roles",
  );
}

/** Live sessions other users shared with the caller, as active-session rows. */
export function getSharedWithMe(): Promise<unknown[]> {
  return call(
    () => api().get<unknown[]>("/shared-with-me"),
    "Failed to list shared sessions",
  );
}

// ---------------------------------------------------------------------------
// Collab rooms
// ---------------------------------------------------------------------------

export interface CollabRoom {
  id: string;
  name: string;
  ownerUserId: string;
  persistent: boolean;
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
  guestLinkEnabled: boolean;
  createdAt: string;
  endedAt: string | null;
}

export interface CollabRoomMember {
  userId: string;
  username: string;
  roomRole: string;
  createdAt: string;
}

export interface CollabOnlineUser {
  userId: string;
  username: string;
}

export interface CollabStage {
  presenterUserId: string | null;
  protocol: "ssh" | "rdp" | "vnc" | "telnet" | null;
  hostId: number | null;
  shareId: string | null;
  sessionId?: string;
  controllerUserId?: string | null;
  connectParams?: { token: string };
}

export interface CollabControlRequest {
  userId: string;
  username: string;
  requestedAt: string;
}

export interface CollabRoomDetail {
  room: CollabRoom;
  me: string;
  isHost: boolean;
  members: CollabRoomMember[];
  online: CollabOnlineUser[];
  stage: CollabStage;
  /** Anonymous guests watching the stage through the guest link. */
  guests?: { label: string | null }[];
  controllerUserId: string | null;
  controlRequests: CollabControlRequest[];
  /** Where live room events are served, as /plugin-ws/<id>/<path>. */
  eventsWsPath: string;
}

export interface CollabGuestStage {
  protocol: "ssh" | "rdp" | "vnc" | "telnet";
  shareId: string;
  wsPath?: string;
  connectParams?: { token: string };
}

/** Anonymous: guests poll this to follow the presenter. Throws on 404/429. */
export async function resolveCollabGuestStage(
  token: string,
): Promise<{ roomName: string; stage: CollabGuestStage | null }> {
  const response = await api().get<{
    roomName: string;
    stage: CollabGuestStage | null;
  }>(`/guest/${encodeURIComponent(token)}`);
  return response.data;
}
