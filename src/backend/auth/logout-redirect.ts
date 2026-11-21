import type { Request } from "express";
import { createCurrentSessionRepository } from "../database/repositories/factory.js";
import { authLogger } from "../utils/logger.js";
import { getRequestBaseUrlWithForceHTTPS } from "../utils/request-origin.js";
import { getLoginMethod } from "./registry.js";
import type { ExternalSessionRef } from "./types.js";

const LOGOUT_REDIRECT_TIMEOUT_MS = 5000;

function readRef(value: string | null | undefined): ExternalSessionRef | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as ExternalSessionRef)
      : null;
  } catch {
    return null;
  }
}

/** A sign out address a plugin gave, when it is plain http or https. */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Where the login method that made this session wants the browser to go on
 * sign out, such as the identity provider's own sign out page. Null when it
 * has nothing, fails or takes too long: sign out never waits on it.
 */
export async function logoutRedirectFor(
  sessionId: string | undefined,
  req: Request,
): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const session = await createCurrentSessionRepository().findById(sessionId);
    const ref = readRef(session?.externalSessionRef);
    const method = ref?.methodId ? getLoginMethod(ref.methodId) : undefined;
    if (!ref || !method?.logoutRedirect) return null;
    const ask = method.logoutRedirect({
      providerId: ref.providerId ?? null,
      sub: ref.sub ?? null,
      sid: ref.sid ?? null,
      baseUrl: getRequestBaseUrlWithForceHTTPS(req),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOGOUT_REDIRECT_TIMEOUT_MS);
    });
    try {
      return safeRedirect(await Promise.race([ask, timeout]));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    authLogger.warn("Logout redirect failed", {
      operation: "user_logout_redirect",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
