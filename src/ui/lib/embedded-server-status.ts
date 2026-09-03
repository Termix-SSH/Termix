import { isElectron } from "@/lib/electron";

export type EmbeddedServerFailureReason = "port-in-use" | "crashed";

export interface EmbeddedServerFailure {
  reason: EmbeddedServerFailureReason;
  port: number | null;
}

type EmbeddedServerStatusWindow = Window &
  typeof globalThis & {
    electronAPI?: {
      getEmbeddedServerStatus?: () => Promise<{
        running?: boolean;
        failure?: { reason?: string; port?: number | null } | null;
      }>;
    };
  };

/**
 * Asks the Electron main process whether the embedded backend has failed for
 * good.
 *
 * Returns null in every case where waiting is still the right thing to do:
 * outside Electron, while the backend is only slow to boot, and on a desktop
 * build old enough not to expose the channel at all. A non-null result means
 * the backend process is gone and no amount of retrying will bring it back.
 */
export async function getEmbeddedServerFailure(): Promise<EmbeddedServerFailure | null> {
  if (!isElectron()) return null;

  const getStatus = (window as EmbeddedServerStatusWindow).electronAPI
    ?.getEmbeddedServerStatus;
  if (typeof getStatus !== "function") return null;

  try {
    const status = await getStatus();
    const failure = status?.failure;
    if (!failure) return null;

    // An unrecognized reason from a newer/older main process still means the
    // backend is down, which is the part the caller acts on -- so it is
    // reported as the generic crash rather than dropped.
    return failure.reason === "port-in-use"
      ? { reason: "port-in-use", port: failure.port ?? null }
      : { reason: "crashed", port: null };
  } catch {
    // No status channel, or the main process is tearing down. Neither is
    // evidence that the backend failed, so keep waiting.
    return null;
  }
}
