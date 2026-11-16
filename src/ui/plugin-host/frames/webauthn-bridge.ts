/**
 * WebAuthn steps a plugin's own screens ask for (adding a passkey, proving a
 * key before removing one). The shell runs them with the plugin id it knows
 * for the asking frame, never one the frame names: core makes the options
 * through that plugin's backend, the browser prompt runs here, and the answer
 * goes back to the same backend. The frame gets only what the backend's check
 * returned. Login and second factor steps never go through here.
 */

import {
  finishPluginCeremony,
  startPluginCeremony,
} from "@/api/auth-methods-api";
import { promptClosed, runWebAuthn } from "@/auth/webauthn-browser";

const running = new Set<string>();

export function readCeremonyId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value)
    ? value
    : null;
}

/** Plain values only, the same rule core applies. */
export function readCeremonyExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bad ceremony input");
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      out[key] = item;
    }
  }
  return out;
}

/** One step at a time per owner (a frame, or a plugin in the page). */
export async function runPluginCeremony(
  owner: string,
  pluginId: string,
  ceremonyId: string,
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (running.has(owner)) throw new Error("A security key step is open");
  running.add(owner);
  try {
    const start = await startPluginCeremony(pluginId, ceremonyId, extra);
    let response: Record<string, unknown>;
    try {
      response = await runWebAuthn(start.type, start.publicKey);
    } catch (error) {
      // Closing the browser prompt is an answer, not a failure.
      if (promptClosed(error)) return { ok: false, closed: true };
      throw error;
    }
    return await finishPluginCeremony(
      pluginId,
      ceremonyId,
      start.ticket,
      response,
    );
  } finally {
    running.delete(owner);
  }
}

/** Test seam. */
export function resetWebAuthnBridge(): void {
  running.clear();
}
