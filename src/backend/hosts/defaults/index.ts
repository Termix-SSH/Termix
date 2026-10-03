import { databaseLogger } from "../../utils/logger.js";
import { recompute } from "./recompute.js";

export { applyHostDefaultsToWrite } from "./write-rules.js";

/**
 * Brings one host's plugin settings in line with its defaults after a write,
 * and, when it moved folder or parent, every host of its owner (a sub-host
 * follows its parent's folder). A failure here never fails the write.
 */
export async function applyDefaultsAfterHostWrite(
  hostId: number,
  options: { moved?: boolean; ownerId?: string } = {},
): Promise<void> {
  try {
    await recompute({ hostIds: [hostId] });
    if (options.moved && options.ownerId) {
      void recompute({ userIds: [options.ownerId] }).catch(() => {});
    }
  } catch (error) {
    databaseLogger.warn("Could not apply host defaults after a write", {
      operation: "host_defaults_after_write",
      hostId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The same for many hosts written in one go (an import), in a single pass
 * instead of one per host.
 */
export async function applyDefaultsAfterHostWrites(
  hostIds: number[],
): Promise<void> {
  if (hostIds.length === 0) return;
  try {
    await recompute({ hostIds });
  } catch (error) {
    databaseLogger.warn("Could not apply host defaults after a write", {
      operation: "host_defaults_after_write",
      hosts: hostIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
