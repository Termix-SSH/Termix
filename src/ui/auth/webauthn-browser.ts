/**
 * The browser's WebAuthn prompt, run by the shell. Plugin frames can't reach
 * navigator.credentials (their origin is opaque), so login, second factors
 * and plugin ceremonies all come through here with options a plugin's
 * backend made.
 */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

export function webAuthnSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** Runs the prompt and returns the answer as JSON for the plugin's backend. */
export async function runWebAuthn(
  type: "get" | "create",
  publicKey: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response =
    type === "create"
      ? await startRegistration({ optionsJSON: publicKey as never })
      : await startAuthentication({ optionsJSON: publicKey as never });
  return response as unknown as Record<string, unknown>;
}

/** The person closed the prompt; nothing to report. */
export function promptClosed(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

/**
 * A factor's challenge as WebAuthn options: `{ publicKey, context }`, or the
 * request options JSON alone. Null when it is neither.
 */
export function readWebAuthnStart(value: unknown): {
  publicKey: Record<string, unknown>;
  context: Record<string, unknown>;
} | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const wrapped = raw.publicKey && typeof raw.publicKey === "object";
  const publicKey = (wrapped ? raw.publicKey : raw) as Record<string, unknown>;
  if (typeof publicKey.challenge !== "string") return null;
  const context =
    wrapped && raw.context && typeof raw.context === "object"
      ? (raw.context as Record<string, unknown>)
      : {};
  return { publicKey, context };
}
