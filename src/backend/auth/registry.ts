/**
 * Login methods and second factors, from core and from plugins.
 *
 * Password login is registered by core and always present. Everything else
 * (OIDC, LDAP, passkeys, TOTP, ...) registers here from a plugin through
 * ctx.auth.
 */

import type {
  PluginLoginMethod,
  PluginSecondFactor,
  PluginWebAuthnCeremony,
} from "@termix-ssh/plugin-sdk/backend";

export type LoginMethod = PluginLoginMethod & { pluginId: string };
export type SecondFactor = PluginSecondFactor & { pluginId: string };
export type WebAuthnCeremony = PluginWebAuthnCeremony & { pluginId: string };

const loginMethods = new Map<string, LoginMethod>();
const secondFactors = new Map<string, SecondFactor>();
// Keyed by plugin id (which has no colon) and ceremony id, so one plugin
// never reaches another's.
const ceremonies = new Map<string, WebAuthnCeremony>();

const ceremonyKey = (pluginId: string, id: string) => `${pluginId}:${id}`;

function register<T extends { id: string; pluginId: string }>(
  map: Map<string, T>,
  kind: string,
  entry: T,
): () => void {
  const existing = map.get(entry.id);
  if (existing && existing.pluginId !== entry.pluginId) {
    throw new Error(
      `${kind} "${entry.id}" is already provided by ${existing.pluginId}`,
    );
  }
  map.set(entry.id, entry);
  return () => {
    if (map.get(entry.id) === entry) map.delete(entry.id);
  };
}

export function registerLoginMethod(method: LoginMethod): () => void {
  return register(loginMethods, "Login method", method);
}

export function getLoginMethod(id: string): LoginMethod | undefined {
  return loginMethods.get(id);
}

export function listLoginMethods(): LoginMethod[] {
  return [...loginMethods.values()];
}

export function registerSecondFactor(factor: SecondFactor): () => void {
  return register(secondFactors, "Second factor", factor);
}

export function getSecondFactor(
  pluginId: string,
  factorId: string,
): SecondFactor | undefined {
  const factor = secondFactors.get(factorId);
  return factor && factor.pluginId === pluginId ? factor : undefined;
}

export function listSecondFactors(): SecondFactor[] {
  return [...secondFactors.values()];
}

export function registerWebAuthnCeremony(
  ceremony: WebAuthnCeremony,
): () => void {
  const key = ceremonyKey(ceremony.pluginId, ceremony.id);
  ceremonies.set(key, ceremony);
  return () => {
    if (ceremonies.get(key) === ceremony) ceremonies.delete(key);
  };
}

/** A plugin's own ceremony, never another plugin's. */
export function getWebAuthnCeremony(
  pluginId: string,
  id: string,
): WebAuthnCeremony | undefined {
  return ceremonies.get(ceremonyKey(pluginId, id));
}

/** Test helper. */
export function resetAuthRegistryForTests(): void {
  loginMethods.clear();
  secondFactors.clear();
  ceremonies.clear();
}
