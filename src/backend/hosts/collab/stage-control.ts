/**
 * Who besides the presenter may drive the current stage, per room.
 *
 * Deliberately in-memory: control is a property of the live stage, and the
 * stage itself (SSH session / guacd connection) is process-local already.
 * Every stage switch clears it.
 */
const controllers = new Map<string, string>();

export function getStageController(roomId: string): string | null {
  return controllers.get(roomId) ?? null;
}

export function setStageController(
  roomId: string,
  userId: string | null,
): void {
  if (userId) controllers.set(roomId, userId);
  else controllers.delete(roomId);
}
