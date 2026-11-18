/**
 * What a verified session may reach, by path. HTTP middleware and the socket
 * upgrade both ask here, so a socket follows the same rules as a request.
 */

import { listSecondFactors } from "./registry.js";
import { SECOND_FACTOR_SETUP } from "./policy.js";

const PLUGIN_ROUTE_PATH = /^\/plugin-(?:api|ws)\/([a-z][a-z0-9-]*)(\/|$)/;

// Routes that change how a user signs in or mint a credential that outlives
// the session. A plugin-minted session is refused on them, and on every
// route and socket of a plugin that provides a second factor.
const PLUGIN_SESSION_BLOCKLIST = [
  /^\/users\/(change-password|api-keys|link-external-to-password|unlink-external-from-password|admin\/reset-password)(\/|$)/,
  /^\/users\/admin\/[^/]+\/second-factors(\/|$)/,
];

// What a session that must set up a second factor first may call: who am I,
// sign out, the login and factor routes, plugin bundles, and the plugins that
// provide a second factor.
const SETUP_SESSION_ALLOWLIST = [
  /^\/users\/(me|logout)$/,
  /^\/users\/auth\//,
  /^\/plugin-assets\//,
];

// Reads the setup screen needs to draw the app shell. Writes and admin views
// under the same prefixes stay closed until a factor is set up.
const SETUP_SESSION_READS = [
  /^\/user-preferences\/look$/,
  /^\/plugins$/,
  /^\/plugins\/public(-manifest)?$/,
  /^\/plugins\/[^/]+\/settings\/user$/,
];

function isSecondFactorPlugin(path: string): boolean {
  const plugin = PLUGIN_ROUTE_PATH.exec(path)?.[1];
  return (
    !!plugin && listSecondFactors().some((factor) => factor.pluginId === plugin)
  );
}

/** Whether a session a plugin minted may call this path. */
export function allowsPluginSession(path: string): boolean {
  if (PLUGIN_SESSION_BLOCKLIST.some((pattern) => pattern.test(path))) {
    return false;
  }
  return !isSecondFactorPlugin(path);
}

/**
 * Whether a session restricted to second factor setup may call this path. A
 * socket upgrade has no method of its own and counts as a read.
 */
export function allowsSetupSession(path: string, method = "GET"): boolean {
  if (SETUP_SESSION_ALLOWLIST.some((pattern) => pattern.test(path))) {
    return true;
  }
  const read = method === "GET" || method === "HEAD";
  if (read && SETUP_SESSION_READS.some((pattern) => pattern.test(path))) {
    return true;
  }
  return isSecondFactorPlugin(path);
}

export interface SessionAccessInput {
  pendingTOTP?: boolean;
  restriction?: string | null;
  pluginSession?: boolean;
}

export interface SessionRefusal {
  status: number;
  code: string;
  error: string;
}

/** Why this session may not reach this path, or null when it may. */
export function sessionAccessRefusal(
  session: SessionAccessInput,
  path: string,
  method = "GET",
): SessionRefusal | null {
  if (session.pendingTOTP) {
    return {
      status: 401,
      code: "TOTP_REQUIRED",
      error: "TOTP verification required",
    };
  }
  // Any restriction this code does not know is treated like setup.
  if (session.restriction && !allowsSetupSession(path, method)) {
    return {
      status: 403,
      code:
        session.restriction === SECOND_FACTOR_SETUP
          ? "SECOND_FACTOR_SETUP_REQUIRED"
          : "SESSION_RESTRICTED",
      error: "Set up a second factor before using Termix",
    };
  }
  if (session.pluginSession && !allowsPluginSession(path)) {
    return {
      status: 403,
      code: "PLUGIN_SESSION_NOT_ALLOWED",
      error: "A session a plugin issued cannot use this route",
    };
  }
  return null;
}
