/** Display name and email checks shared by the profile routes and ctx.users. */

export const DISPLAY_NAME_MAX = 64;
export const EMAIL_MAX = 254;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProfileInput =
  | { ok: true; update: { displayName?: string | null; email?: string | null } }
  | { ok: false; error: string };

/** Checks a display name and email from a request body. */
export function readProfileInput(body: unknown): ProfileInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const update: { displayName?: string | null; email?: string | null } = {};

  if (input.displayName !== undefined) {
    if (input.displayName !== null && typeof input.displayName !== "string") {
      return { ok: false, error: "Display name must be text" };
    }
    const name =
      typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (name.length > DISPLAY_NAME_MAX) {
      return { ok: false, error: "Display name is too long" };
    }
    update.displayName = name || null;
  }

  if (input.email !== undefined) {
    if (input.email !== null && typeof input.email !== "string") {
      return { ok: false, error: "Email must be text" };
    }
    const email =
      typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email && (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))) {
      return { ok: false, error: "Email is not valid" };
    }
    update.email = email || null;
  }

  if (update.displayName === undefined && update.email === undefined) {
    return { ok: false, error: "Nothing to change" };
  }
  return { ok: true, update };
}
