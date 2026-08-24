import { createCurrentCollabRoomRepository } from "../../database/repositories/factory.js";

/**
 * Whether a user may join a room-stage share: the share must be the stage of
 * a live room they are a member of. Membership is the authorization - room
 * stages are read-only and never expose host credentials or config.
 */
export async function canJoinRoomStageShare(
  shareId: string,
  userId: string,
): Promise<boolean> {
  const repository = createCurrentCollabRoomRepository();
  const room = await repository.findByStageShareId(shareId);
  if (!room) return false;
  return !!(await repository.findMember(room.id, userId));
}
