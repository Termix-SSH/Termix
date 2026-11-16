import { createCurrentCredentialRepository } from "../database/repositories/factory.js";

export const WITHHELD_LOGIN_MESSAGE =
  "This login is shared with you for connecting through the server only. Set the host to connect from the server, or add a device login for it.";

const SECRET_AUTH_TYPES = new Set(["password", "key", "credential"]);

/** A shared copy whose server sent it without its secret. */
export function isWithheldShare(sharedSource: unknown): boolean {
  if (typeof sharedSource !== "string" || !sharedSource) return false;
  try {
    const parsed = JSON.parse(sharedSource) as { secretWithheld?: unknown };
    return parsed?.secretWithheld === true;
  } catch {
    return false;
  }
}

/**
 * On a linked desktop, whether this host needs a login the server kept to
 * itself. Connecting here would only fail at auth, so callers refuse early.
 */
export async function sharedLoginWithheld(
  host: Record<string, unknown>,
): Promise<boolean> {
  if (process.env.ELECTRON_EMBEDDED !== "true") return false;
  if (!SECRET_AUTH_TYPES.has(String(host.authType ?? ""))) return false;
  if (host.password || host.key) return false;
  if (isWithheldShare(host.sharedSource)) return true;
  if (!host.credentialId) return false;
  try {
    const row = await createCurrentCredentialRepository().findById(
      Number(host.credentialId),
    );
    return (
      !!row && isWithheldShare((row as { sharedSource?: unknown }).sharedSource)
    );
  } catch {
    return false;
  }
}
