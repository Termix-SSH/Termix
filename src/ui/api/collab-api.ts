import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";
import { resolveApiBaseUrl } from "@/api/session-sharing-api";

export interface CollabRoom {
  id: string;
  name: string;
  ownerUserId: string;
  persistent: boolean;
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
  guestLinkToken: string | null;
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

export interface CollabRoomDetail {
  room: CollabRoom;
  me: string;
  isHost: boolean;
  members: CollabRoomMember[];
  online: CollabOnlineUser[];
  stage: CollabStage;
  controllerUserId: string | null;
}

export async function listCollabRooms(): Promise<{ rooms: CollabRoom[] }> {
  try {
    const response = await authApi.get("/collab/rooms");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "list collab rooms");
  }
}

export async function createCollabRoom(
  name: string,
  persistent: boolean,
): Promise<{ room: CollabRoom }> {
  try {
    const response = await authApi.post("/collab/rooms", { name, persistent });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create collab room");
  }
}

export async function getCollabRoom(roomId: string): Promise<CollabRoomDetail> {
  try {
    const response = await authApi.get(`/collab/rooms/${roomId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get collab room");
  }
}

export async function inviteCollabMembers(
  roomId: string,
  targets: { userIds?: string[]; roleIds?: number[] },
): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/members`, targets);
  } catch (error) {
    throw handleApiError(error, "invite collab members");
  }
}

export async function removeCollabMember(
  roomId: string,
  userId: string,
): Promise<void> {
  try {
    await authApi.delete(`/collab/rooms/${roomId}/members/${userId}`);
  } catch (error) {
    throw handleApiError(error, "remove collab member");
  }
}

export async function presentCollabStage(
  roomId: string,
  input: { protocol: string; sessionId: string; hostId: number },
): Promise<{ stage: CollabStage }> {
  try {
    const response = await authApi.post(
      `/collab/rooms/${roomId}/present`,
      input,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "start presenting");
  }
}

export async function stopCollabStage(roomId: string): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/stop`);
  } catch (error) {
    throw handleApiError(error, "stop presenting");
  }
}

export async function getCollabStage(
  roomId: string,
): Promise<{ stage: CollabStage | null }> {
  try {
    const response = await authApi.get(`/collab/rooms/${roomId}/stage`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "resolve collab stage");
  }
}

export async function setCollabStageControl(
  roomId: string,
  userId: string | null,
): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/control`, { userId });
  } catch (error) {
    throw handleApiError(error, "change stage control");
  }
}

export async function requestCollabStageControl(roomId: string): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/control/request`);
  } catch (error) {
    throw handleApiError(error, "request stage control");
  }
}

export async function endCollabRoom(roomId: string): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/end`);
  } catch (error) {
    throw handleApiError(error, "end collab room");
  }
}

export async function setCollabGuestLink(
  roomId: string,
  enabled: boolean,
): Promise<{ guestLinkToken: string | null }> {
  try {
    const response = await authApi.post(`/collab/rooms/${roomId}/guest-link`, {
      enabled,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update guest link");
  }
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
  const baseUrl = await resolveApiBaseUrl();
  const response = await axios.get(
    `${baseUrl}/collab/guest/${encodeURIComponent(token)}`,
  );
  return response.data;
}
