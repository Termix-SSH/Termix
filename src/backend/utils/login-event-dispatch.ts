import { pluginEvents, TOPICS } from "../plugins/events.js";
import { sshLogger } from "./logger.js";

/**
 * Announces an SSH login so anything watching can react to it.
 *
 * Was an HTTP POST to the metrics service on localhost:30005. Host metrics is
 * a plugin now and has no port, so this publishes on the plugin event bus and
 * the plugin subscribes. Fire and forget: a subscriber that throws must never
 * fail the login that caused it.
 */
export async function dispatchLoginEvent(
  hostId: number,
  userId: string,
  sshUser: string,
  fromIp: string,
): Promise<void> {
  try {
    pluginEvents.emit(TOPICS.hostLogin, { hostId, userId, sshUser, fromIp });
  } catch (err) {
    sshLogger.warn("Failed to dispatch login event", {
      operation: "login_event_dispatch_error",
      hostId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
