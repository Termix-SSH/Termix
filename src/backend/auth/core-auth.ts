/**
 * Core's own login method (password) and the lockout guard.
 */

import { getCurrentSettingValue } from "../database/repositories/factory.js";
import { authLogger } from "../utils/logger.js";
import { isTrustedProxyAuthEnabled } from "../utils/trusted-proxy-auth.js";
import { registerPasswordLoginMethod } from "./builtin-login-methods.js";
import { listLoginMethods } from "./registry.js";
import { LoginMethodError } from "./types.js";

let registered = false;

/** Registers core's login methods and factors once. */
export function ensureCoreLoginProviders(): void {
  if (registered) return;
  registered = true;
  registerPasswordLoginMethod();
}

/** Test helper. */
export function resetCoreLoginProvidersForTests(): void {
  registered = false;
}

/** The admin setting (or ALLOW_PASSWORD_LOGIN), before the lockout guard. */
function isPasswordLoginSettingOn(): boolean {
  const envVal = process.env.ALLOW_PASSWORD_LOGIN;
  if (envVal !== undefined) return envVal.trim().toLowerCase() === "true";
  try {
    const value = getCurrentSettingValue("allow_password_login");
    return value ? value === "true" : true;
  } catch {
    return true;
  }
}

/**
 * Refuses a new second-factor enrolment when core could not honour it: with
 * trusted proxy login on the proxy decides who signs in, and with password
 * login off users sign in through external methods that skip second factors
 * by default.
 */
export function assertSecondFactorEnrollmentAllowed(): void {
  if (isTrustedProxyAuthEnabled()) {
    throw new LoginMethodError(
      "Second factors are disabled while trusted proxy authentication is enabled",
      409,
      "trusted_proxy_enabled",
    );
  }
  if (!isPasswordLoginSettingOn()) {
    throw new LoginMethodError(
      "Cannot enable 2FA while password login is disabled. Enable password login first.",
      409,
      "password_login_disabled",
    );
  }
}

/**
 * Off by default, matching 2.8: second factors only ran after password and
 * other local form logins. On, they also run after external methods (SSO,
 * LDAP), which needs the pending-cookie/temp_token step those methods'
 * clients (Termix-Mobile included) may not handle yet.
 */
export function isSecondFactorAfterExternalLoginEnabled(): boolean {
  try {
    const value = getCurrentSettingValue("second_factor_after_external_login");
    return value === "true";
  } catch {
    return false;
  }
}

/**
 * Whether anyone could still sign in without a password: trusted proxy auth,
 * or a login method reporting an enabled instance (an SSO provider).
 */
async function hasOtherEnabledLoginMethod(): Promise<boolean> {
  if (isTrustedProxyAuthEnabled()) return true;
  ensureCoreLoginProviders();
  for (const method of listLoginMethods()) {
    if (method.id === "password" || !method.describe) continue;
    try {
      const instances = await method.describe();
      if (instances.some((instance) => instance.enabled)) return true;
    } catch {
      // A method that cannot describe itself does not count.
    }
  }
  return false;
}

export interface PasswordLoginStatus {
  allowed: boolean;
  /** Turned off by the admin but kept on so nobody is locked out. */
  forced: boolean;
}

/**
 * Password login is off only when the admin turned it off AND another way to
 * sign in exists. Otherwise it stays on, with a warning, so that disabling it
 * (or losing the only SSO provider) can never lock everyone out.
 */
export async function getPasswordLoginStatus(): Promise<PasswordLoginStatus> {
  if (isPasswordLoginSettingOn()) return { allowed: true, forced: false };
  if (await hasOtherEnabledLoginMethod()) {
    return { allowed: false, forced: false };
  }
  authLogger.warn(
    "Password login is disabled but no other login method is enabled; keeping it on",
    { operation: "password_login_lockout_guard" },
  );
  return { allowed: true, forced: true };
}
