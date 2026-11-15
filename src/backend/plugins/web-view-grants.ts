// Pages a plugin's frames may show in a view the shell draws (a native view
// on the desktop, a credentialless sandboxed iframe in a browser). The
// plugin's backend picks the address and the certificate rule here; the
// frame only ever holds the grant id, so it can't point the view anywhere
// else or widen what it trusts.

import crypto from "node:crypto";

const GRANT_TTL_MS = 10 * 60 * 1000;
const MAX_GRANTS_PER_PLUGIN = 50;
const MAX_URL_LENGTH = 8192;

export interface ViewGrant {
  grant: string;
  pluginId: string;
  userId: string;
  sessionId?: string;
  url: string;
  origin: string;
  /** Accept an invalid TLS certificate from `origin` only. */
  ignoreCert: boolean;
  expiresAt: number;
}

const grants = new Map<string, ViewGrant>();

/** The address a grant may hold, or an error saying why not. */
export function checkGrantUrl(
  value: unknown,
): { url: URL } | { error: string } {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    return { error: "A view needs an http or https address" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "A view needs an http or https address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "A view needs an http or https address" };
  }
  if (url.username || url.password) {
    return { error: "A view address can't carry a login" };
  }
  return { url };
}

function sweep(now: number): void {
  for (const [id, entry] of grants) {
    if (entry.expiresAt <= now) grants.delete(id);
  }
}

export function createViewGrant(input: {
  pluginId: string;
  userId: string;
  sessionId?: string;
  url: unknown;
  ignoreCert?: unknown;
}): ViewGrant {
  const checked = checkGrantUrl(input.url);
  if ("error" in checked) throw new Error(checked.error);
  const now = Date.now();
  sweep(now);
  const own = [...grants.values()]
    .filter((entry) => entry.pluginId === input.pluginId)
    .sort((a, b) => a.expiresAt - b.expiresAt);
  for (const old of own.slice(0, own.length - MAX_GRANTS_PER_PLUGIN + 1)) {
    grants.delete(old.grant);
  }
  const entry: ViewGrant = {
    grant: crypto.randomBytes(24).toString("hex"),
    pluginId: input.pluginId,
    userId: input.userId,
    sessionId: input.sessionId,
    url: checked.url.href,
    origin: checked.url.origin,
    ignoreCert: input.ignoreCert === true && checked.url.protocol === "https:",
    expiresAt: now + GRANT_TTL_MS,
  };
  grants.set(entry.grant, entry);
  return entry;
}

/**
 * The grant when it belongs to this plugin and this person (and session,
 * when it was made in one), else null.
 */
export function readViewGrant(
  pluginId: string,
  grant: unknown,
  userId: string,
  sessionId?: string,
): ViewGrant | null {
  if (typeof grant !== "string" || !/^[0-9a-f]{48}$/.test(grant)) return null;
  const entry = grants.get(grant);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    grants.delete(grant);
    return null;
  }
  if (entry.pluginId !== pluginId || entry.userId !== userId) return null;
  if (entry.sessionId && entry.sessionId !== sessionId) return null;
  return entry;
}

/** A plugin stopped: its pages go with it. */
export function dropViewGrants(pluginId: string): void {
  for (const [id, entry] of grants) {
    if (entry.pluginId === pluginId) grants.delete(id);
  }
}

/** Test seam. */
export function resetViewGrants(): void {
  grants.clear();
}
