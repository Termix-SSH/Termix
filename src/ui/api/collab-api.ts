import { authApi, handleApiError } from "@/main-axios";

export interface CollabRoom {
  id: string;
  name: string;
  ownerUserId: string;
  persistent: boolean;
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
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
  connectParams?: { token: string };
}

export interface CollabRoomDetail {
  room: CollabRoom;
  me: string;
  isHost: boolean;
  members: CollabRoomMember[];
  online: CollabOnlineUser[];
  stage: CollabStage;
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
  userIds: string[],
): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/members`, { userIds });
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

export async function endCollabRoom(roomId: string): Promise<void> {
  try {
    await authApi.post(`/collab/rooms/${roomId}/end`);
  } catch (error) {
    throw handleApiError(error, "end collab room");
  }
}
