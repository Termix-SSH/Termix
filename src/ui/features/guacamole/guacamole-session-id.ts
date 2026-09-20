import { getGuacamoleConnectionId } from "@/api/guacamole-api";
import type { ConnectionOrigin } from "@/lib/connection-origin";

export function watchGuacamoleConnectionId(
  connectId: string,
  origin: ConnectionOrigin,
  onReady: (id: string) => void,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const poll = async () => {
    try {
      const id = await getGuacamoleConnectionId(
        connectId,
        origin,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (id) onReady(id);
      else if (++attempts < 20) timer = setTimeout(poll, 500);
    } catch {
      // Session sharing discovery must not interrupt the remote display.
    }
  };
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
