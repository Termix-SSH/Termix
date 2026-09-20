/**
 * Who besides the presenter may drive the current stage, per room.
 *
 * Redis-backed when REDIS_URL is configured, with a local fallback for
 * single-instance deployments. Every stage switch clears it.
 */
import { collabRuntimeStore } from "./runtime-store.js";

export function getStageController(roomId: string): Promise<string | null> {
  return collabRuntimeStore.getController(roomId);
}

export function setStageController(
  roomId: string,
  userId: string | null,
): Promise<void> {
  return collabRuntimeStore.setController(roomId, userId);
}
