/**
 * Login policy from plugins through ctx.auth.policy.provide: idle timeout,
 * session length, remember me and a required second factor. Core asks every
 * provider and the strictest answer wins. A provider that throws at login
 * refuses the login, since skipping a security rule is worse than a failed
 * sign in. The idle timeout is stored on the session at login. Desktop
 * loopback, sync link and plugin minted sessions are device credentials, not
 * logins, so the policy never reaches them.
 */

import type {
  PluginAuthPolicyDecision,
  PluginAuthPolicyInput,
  PluginAuthPolicyProvider,
} from "@termix-ssh/plugin-sdk/backend";
import { authLogger } from "../utils/logger.js";
import { LoginMethodError } from "./types.js";

/** sessions.restriction of a session that may only set up a second factor. */
export const SECOND_FACTOR_SETUP = "second-factor-setup";

interface Entry {
  pluginId: string;
  provider: PluginAuthPolicyProvider;
}

const providers = new Map<symbol, Entry>();

export function provideAuthPolicy(
  pluginId: string,
  provider: PluginAuthPolicyProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearAuthPolicies(): void {
  providers.clear();
}

export function hasAuthPolicies(): boolean {
  return providers.size > 0;
}

export interface AuthPolicy {
  allowRememberDevice: boolean;
  maxSessionSeconds: number | null;
  idleTimeoutSeconds: number | null;
  secondFactor: "always" | "new-device" | null;
}

const NO_POLICY: AuthPolicy = {
  allowRememberDevice: true,
  maxSessionSeconds: null,
  idleTimeoutSeconds: null,
  secondFactor: null,
};

function shortest(current: number | null, next: unknown): number | null {
  if (typeof next !== "number" || !(next > 0)) return current;
  const value = Math.floor(next);
  return current === null ? value : Math.min(current, value);
}

function merge(policy: AuthPolicy, next: PluginAuthPolicyDecision): AuthPolicy {
  let secondFactor = policy.secondFactor;
  if (next.secondFactor === "always") secondFactor = "always";
  else if (next.secondFactor === "new-device" && secondFactor !== "always") {
    secondFactor = "new-device";
  }
  return {
    allowRememberDevice:
      policy.allowRememberDevice && next.allowRememberDevice !== false,
    maxSessionSeconds: shortest(
      policy.maxSessionSeconds,
      next.maxSessionSeconds,
    ),
    idleTimeoutSeconds: shortest(
      policy.idleTimeoutSeconds,
      next.idleTimeoutSeconds,
    ),
    secondFactor,
  };
}

export async function evaluateAuthPolicy(
  input: PluginAuthPolicyInput,
): Promise<AuthPolicy> {
  let policy = NO_POLICY;
  for (const entry of providers.values()) {
    let decision: PluginAuthPolicyDecision;
    try {
      decision = (await entry.provider.evaluate(input)) ?? {};
    } catch (error) {
      authLogger.warn("Login policy failed, refusing the login", {
        operation: "auth_policy",
        pluginId: entry.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new LoginMethodError(
        "Sign in is not available right now. Contact an admin.",
        503,
        "auth_policy_unavailable",
      );
    }
    policy = merge(policy, decision);
  }
  return policy;
}

/** Whether the login page should offer remember me. */
export function rememberDeviceAllowed(): boolean {
  for (const entry of providers.values()) {
    try {
      if (entry.provider.allowRememberDevice?.() === false) return false;
    } catch {
      return false;
    }
  }
  return true;
}
