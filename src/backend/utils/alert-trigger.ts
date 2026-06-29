import { SystemCrypto } from "./system-crypto.js";
import { sshLogger } from "./logger.js";

const METRICS_SERVICE_URL = "http://localhost:30005";

export async function triggerLoginAlert(
  hostId: number,
  userId: string,
  sshUser: string,
  fromIp: string,
): Promise<void> {
  try {
    const token = await SystemCrypto.getInstance().getInternalAuthToken();
    await fetch(`${METRICS_SERVICE_URL}/internal/login-alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-auth": token,
      },
      body: JSON.stringify({ hostId, userId, sshUser, fromIp }),
    });
  } catch (err) {
    sshLogger.warn("Failed to trigger login alert", {
      operation: "login_alert_trigger_error",
      hostId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
