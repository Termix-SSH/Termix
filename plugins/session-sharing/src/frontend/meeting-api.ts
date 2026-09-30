import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type {
  CollabRoom,
  CollabRoomDetail,
  CollabStage,
  CollabControlRequest,
  DirectoryUser,
  DirectoryRole,
} from "./api";

export function createMeetingApi(
  client: PluginApiClient,
  assertCurrent: () => Promise<void>,
) {
  const api = () => client;
  async function call<T>(
    request: () => Promise<{ data: T }>,
    fallback: string,
  ): Promise<T> {
    await assertCurrent();
    try {
      return (await request()).data;
    } catch (error) {
      const response = error as { response?: { data?: { error?: string } } };
      throw new Error(response.response?.data?.error || fallback);
    }
  }
  const room = (roomId: string, suffix = "") =>
    `/rooms/${encodeURIComponent(roomId)}${suffix}`;

  function listCollabRooms(): Promise<{ rooms: CollabRoom[] }> {
    return call(
      () => api().get<{ rooms: CollabRoom[] }>("/rooms"),
      "Failed to list rooms",
    );
  }

  function createCollabRoom(
    name: string,
    persistent: boolean,
  ): Promise<{ room: CollabRoom }> {
    return call(
      () => api().post<{ room: CollabRoom }>("/rooms", { name, persistent }),
      "Failed to create room",
    );
  }

  function getCollabRoom(roomId: string): Promise<CollabRoomDetail> {
    return call(
      () => api().get<CollabRoomDetail>(room(roomId)),
      "Failed to get room",
    );
  }

  async function inviteCollabMembers(
    roomId: string,
    targets: { userIds?: string[]; roleIds?: number[] },
  ): Promise<void> {
    await call(
      () => api().post(room(roomId, "/members"), targets),
      "Failed to invite members",
    );
  }

  async function removeCollabMember(
    roomId: string,
    userId: string,
  ): Promise<void> {
    await call(
      () =>
        api().delete(room(roomId, `/members/${encodeURIComponent(userId)}`)),
      "Failed to remove member",
    );
  }

  function presentCollabStage(
    roomId: string,
    input: { protocol: string; sessionId: string; hostId: number },
  ): Promise<{ stage: CollabStage }> {
    return call(
      () => api().post<{ stage: CollabStage }>(room(roomId, "/present"), input),
      "Failed to start presenting",
    );
  }

  async function stopCollabStage(roomId: string): Promise<void> {
    await call(
      () => api().post(room(roomId, "/stop")),
      "Failed to stop presenting",
    );
  }

  function getCollabStage(
    roomId: string,
  ): Promise<{ stage: CollabStage | null }> {
    return call(
      () => api().get<{ stage: CollabStage | null }>(room(roomId, "/stage")),
      "Failed to resolve stage",
    );
  }

  async function setCollabStageControl(
    roomId: string,
    userId: string | null,
  ): Promise<void> {
    await call(
      () => api().post(room(roomId, "/control"), { userId }),
      "Failed to change stage control",
    );
  }

  function requestCollabStageControl(
    roomId: string,
  ): Promise<{ request: CollabControlRequest }> {
    return call(
      () =>
        api().post<{ request: CollabControlRequest }>(
          room(roomId, "/control/request"),
        ),
      "Failed to request control",
    );
  }

  function listCollabControlRequests(
    roomId: string,
  ): Promise<{ requests: CollabControlRequest[] }> {
    return call(
      () =>
        api().get<{ requests: CollabControlRequest[] }>(
          room(roomId, "/control/requests"),
        ),
      "Failed to list control requests",
    );
  }

  async function dismissCollabControlRequest(
    roomId: string,
    userId: string,
  ): Promise<void> {
    await call(
      () =>
        api().delete(
          room(roomId, `/control/requests/${encodeURIComponent(userId)}`),
        ),
      "Failed to dismiss control request",
    );
  }

  async function endCollabRoom(roomId: string): Promise<void> {
    await call(() => api().post(room(roomId, "/end")), "Failed to end room");
  }

  async function deleteCollabRoom(roomId: string): Promise<void> {
    await call(() => api().delete(room(roomId)), "Failed to delete room");
  }

  function setCollabGuestLink(
    roomId: string,
    enabled: boolean,
  ): Promise<{ guestLinkToken: string | null }> {
    return call(
      () =>
        api().post<{ guestLinkToken: string | null }>(
          room(roomId, "/guest-link"),
          { enabled },
        ),
      "Failed to update guest link",
    );
  }

  async function removeCollabGuests(roomId: string): Promise<void> {
    await call(
      () => api().post(room(roomId, "/guests/remove")),
      "Failed to remove guests",
    );
  }

  function getDirectory() {
    return call(
      () =>
        client.get<{ users: DirectoryUser[]; roles: DirectoryRole[] }>(
          "/directory",
        ),
      "Failed to list users and roles",
    );
  }
  function resolveHost(syncId: string) {
    return call(
      () =>
        client.get<{ id: number }>(
          `/meeting-host/${encodeURIComponent(syncId)}`,
        ),
      "The host must be synced to the meeting server before presenting",
    );
  }
  return {
    listCollabRooms,
    createCollabRoom,
    getCollabRoom,
    inviteCollabMembers,
    removeCollabMember,
    presentCollabStage,
    stopCollabStage,
    getCollabStage,
    setCollabStageControl,
    requestCollabStageControl,
    listCollabControlRequests,
    dismissCollabControlRequest,
    endCollabRoom,
    deleteCollabRoom,
    setCollabGuestLink,
    removeCollabGuests,
    getDirectory,
    resolveHost,
  };
}
