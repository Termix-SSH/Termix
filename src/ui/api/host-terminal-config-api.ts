import { authApi, handleApiError } from "@/main-axios";

/** Flips Auto-Tmux for one host without round-tripping the whole editor form. */
export async function setHostAutoTmux(
  hostId: number,
  autoTmux: boolean,
): Promise<void> {
  try {
    await authApi.patch(`/host/db/host/${hostId}/terminal-config`, {
      autoTmux,
    });
  } catch (error) {
    throw handleApiError(error, "update host auto-tmux");
  }
}
