import { getCurrentSettingValue } from "../database/repositories/factory.js";

/**
 * Admin setting: "true" lets connections with nobody to ask (plugins,
 * schedules, the API) pin a host's first key instead of refusing it.
 */
export const HOST_KEY_TOFU_SETTING = "host_key_trust_on_first_use";

export function hostKeyTrustOnFirstUse(): boolean {
  try {
    return getCurrentSettingValue(HOST_KEY_TOFU_SETTING) === "true";
  } catch {
    return false;
  }
}

export type HostKeyRefusalCode = "HOST_KEY_UNVERIFIED" | "HOST_KEY_CHANGED";

export const HOST_KEY_MESSAGES: Record<HostKeyRefusalCode, string> = {
  HOST_KEY_UNVERIFIED:
    "This host's key is not trusted yet. Open a terminal to the host once to check and trust it.",
  HOST_KEY_CHANGED:
    "This host's key has changed. Open a terminal to the host to check the new key.",
};

const SSH2_REFUSAL = /Host denied \(verification failed\)/;

/**
 * ssh2 reports every refused key as "Host denied". Once the verifier says
 * why, the error the client emits carries that reason and code instead.
 */
export function explainHostKeyRefusal(
  client: { emit: (event: string | symbol, ...args: unknown[]) => boolean },
  code: HostKeyRefusalCode,
): void {
  const emit = client.emit.bind(client);
  client.emit = (event: string | symbol, ...args: unknown[]) => {
    const error = args[0];
    if (
      event === "error" &&
      error instanceof Error &&
      SSH2_REFUSAL.test(error.message)
    ) {
      error.message = HOST_KEY_MESSAGES[code];
      (error as Error & { code?: string }).code = code;
    }
    return emit(event, ...args);
  };
}
