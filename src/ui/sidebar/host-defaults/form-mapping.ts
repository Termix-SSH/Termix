/**
 * Between the host editor's form and host default keys: what value a key has
 * on the form, and how to put a default's value back on it.
 *
 * Core keys use the API's shape ("core.auth" is an object, "core.socks5"
 * too); plugin keys are the plugin's own field values.
 */

import {
  CORE_NAMESPACE,
  CORE_HOST_DEFAULTS,
  defaultValuesEqual,
  findCoreHostDefault,
  splitDefaultKey,
  type DefaultOverrides,
} from "@/types/host-defaults";
import type { HostEditorForm } from "../HostEditorData";

type Form = HostEditorForm;
type PluginValues = Record<string, Record<string, unknown>>;

export const CORE_DEFAULT_KEYS = CORE_HOST_DEFAULTS.map(
  (entry) => `${CORE_NAMESPACE}.${entry.key}`,
);

function coreValue(form: Form, key: string): unknown {
  switch (key) {
    case "username":
      return form.username;
    case "sshPort":
      return form.sshPort;
    case "auth":
      return {
        authType: form.authType,
        credentialId: form.credentialId ? Number(form.credentialId) : null,
        overrideCredentialUsername: form.overrideCredentialUsername,
        agentSocketPath: form.agentSocketPath || null,
        agentIdentity: form.agentIdentity || null,
      };
    case "forceKeyboardInteractive":
    case "keepaliveInterval":
    case "keepaliveCountMax":
    case "allowLegacyAlgorithms":
    case "agentForwarding":
    case "environmentVariables":
    case "portKnockSequence":
    case "statusCheckEnabled":
    case "statusCheckInterval":
      return form[key as keyof Form];
    case "socks5":
      return {
        useSocks5: form.useSocks5,
        socks5Host:
          form.socks5ProxyMode === "single" ? form.socks5Host || null : null,
        socks5Port:
          form.socks5ProxyMode === "single" ? form.socks5Port || null : null,
        socks5Username:
          form.socks5ProxyMode === "single"
            ? form.socks5Username || null
            : null,
        socks5ProxyChain:
          form.socks5ProxyMode === "chain" ? form.socks5ProxyChain : null,
      };
    case "jumpHosts":
      return form.jumpHosts.map((jump) => ({ hostId: Number(jump.hostId) }));
    default:
      return undefined;
  }
}

/** A key's value as the form holds it, normalized for core keys. */
export function formValueForKey(form: Form, fullKey: string): unknown {
  const [namespace, key] = splitDefaultKey(fullKey);
  if (namespace === CORE_NAMESPACE) {
    const entry = findCoreHostDefault(key);
    return entry ? entry.normalize(coreValue(form, key)) : undefined;
  }
  return (form.pluginSettings as PluginValues)?.[namespace]?.[key];
}

/** The form with one key set to a default's value. */
export function applyDefaultToForm(
  form: Form,
  fullKey: string,
  value: unknown,
): Form {
  const [namespace, key] = splitDefaultKey(fullKey);
  if (namespace !== CORE_NAMESPACE) {
    const all = (form.pluginSettings ?? {}) as PluginValues;
    return {
      ...form,
      pluginSettings: {
        ...all,
        [namespace]: { ...(all[namespace] ?? {}), [key]: value },
      },
    };
  }
  const entry = findCoreHostDefault(key);
  const normalized = entry ? entry.normalize(value) : value;
  switch (key) {
    case "username":
      return { ...form, username: (normalized as string | null) ?? "" };
    case "sshPort":
      return { ...form, sshPort: normalized as number };
    case "auth": {
      const auth = normalized as {
        authType: string;
        credentialId: number | null;
        overrideCredentialUsername: boolean;
        agentSocketPath: string | null;
        agentIdentity: string | null;
      } | null;
      if (!auth) return form;
      return {
        ...form,
        authType: auth.authType as Form["authType"],
        credentialId:
          auth.credentialId !== null ? String(auth.credentialId) : "",
        overrideCredentialUsername: auth.overrideCredentialUsername,
        agentSocketPath: auth.agentSocketPath ?? "",
        agentIdentity: auth.agentIdentity ?? "",
      };
    }
    case "socks5": {
      const socks = normalized as {
        useSocks5: boolean;
        socks5Host: string | null;
        socks5Port: number | null;
        socks5Username: string | null;
        socks5ProxyChain: Form["socks5ProxyChain"] | null;
      };
      const chain = socks.socks5ProxyChain ?? [];
      return {
        ...form,
        useSocks5: socks.useSocks5,
        socks5Host: socks.socks5Host ?? "",
        socks5Port: socks.socks5Port ?? 1080,
        socks5Username: socks.socks5Username ?? "",
        socks5ProxyMode: chain.length > 0 ? "chain" : "single",
        socks5ProxyChain: chain.map((node, index) => ({
          ...node,
          // The host's own proxy passwords stay with it.
          ...(form.socks5ProxyChain[index]?.password
            ? { password: form.socks5ProxyChain[index].password }
            : {}),
        })),
      };
    }
    case "jumpHosts":
      return {
        ...form,
        jumpHosts: (normalized as Array<{ hostId: number }>).map((jump) => ({
          hostId: String(jump.hostId),
        })),
      };
    default:
      return { ...form, [key]: normalized } as Form;
  }
}

/** Keys whose value differs between two forms. */
export function changedKeys(
  before: Form,
  after: Form,
  keys: Iterable<string>,
): string[] {
  const changed: string[] = [];
  for (const fullKey of keys) {
    if (
      !defaultValuesEqual(
        formValueForKey(before, fullKey),
        formValueForKey(after, fullKey),
      )
    ) {
      changed.push(fullKey);
    }
  }
  return changed;
}

export function withOwnKeys(
  overrides: DefaultOverrides,
  keys: string[],
): DefaultOverrides {
  if (keys.length === 0) return overrides;
  const next: DefaultOverrides = { ...overrides };
  for (const fullKey of keys) {
    const [namespace, key] = splitDefaultKey(fullKey);
    const own = new Set(next[namespace] ?? []);
    own.add(key);
    next[namespace] = [...own].sort();
  }
  return next;
}

export function withoutOwnKey(
  overrides: DefaultOverrides,
  fullKey: string,
): DefaultOverrides {
  const [namespace, key] = splitDefaultKey(fullKey);
  return {
    ...overrides,
    [namespace]: (overrides[namespace] ?? []).filter((own) => own !== key),
  };
}

export function isOwnDefault(
  overrides: DefaultOverrides | null | undefined,
  fullKey: string,
): boolean {
  const [namespace, key] = splitDefaultKey(fullKey);
  return !!overrides?.[namespace]?.includes(key);
}

/** Every key the overrides mark, as "namespace.key". */
export function ownDefaultKeys(
  overrides: DefaultOverrides | null | undefined,
): string[] {
  return Object.entries(overrides ?? {}).flatMap(([namespace, keys]) =>
    keys.map((key) => `${namespace}.${key}`),
  );
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Which keys a form's values make its own: those that differ from what
 * resolves, and those with a value where nothing resolves.
 */
export function classifyForm(
  form: Form,
  resolved: Record<string, { value: unknown }>,
  keys: Iterable<string>,
): DefaultOverrides {
  const overrides: DefaultOverrides = { [CORE_NAMESPACE]: [] };
  for (const fullKey of keys) {
    const [namespace, key] = splitDefaultKey(fullKey);
    overrides[namespace] ??= [];
    const value = formValueForKey(form, fullKey);
    const entry = resolved[fullKey];
    const own = entry
      ? !defaultValuesEqual(value, entry.value)
      : !isEmpty(value);
    if (own) overrides[namespace].push(key);
  }
  return overrides;
}

/** Every namespace the editor knows is listed, so none is left to guess. */
export function withAllNamespaces(
  overrides: DefaultOverrides,
  keys: Map<string, { namespace: string }>,
): DefaultOverrides {
  const next: DefaultOverrides = { [CORE_NAMESPACE]: [], ...overrides };
  for (const entry of keys.values()) next[entry.namespace] ??= [];
  return next;
}

/**
 * The plugin values a save sends: a host's own values, and every value no
 * default covers (a protocol switch). The server writes the rest.
 */
export function ownPluginValues(
  values: PluginValues | undefined,
  overrides: DefaultOverrides | null,
  keys: Map<string, unknown>,
): PluginValues | undefined {
  if (!values || overrides === null) return values;
  const result: PluginValues = {};
  for (const [pluginId, fields] of Object.entries(values)) {
    const kept = Object.fromEntries(
      Object.entries(fields ?? {}).filter(([key]) => {
        const fullKey = `${pluginId}.${key}`;
        return !keys.has(fullKey) || isOwnDefault(overrides, fullKey);
      }),
    );
    if (Object.keys(kept).length > 0) result[pluginId] = kept;
  }
  return result;
}

/** A plugin's draft for a new host makes what it filled in the host's own. */
export function draftOwnKeys(
  draft: { port?: unknown; username?: unknown; authType?: unknown } | undefined,
): DefaultOverrides {
  const own: string[] = [];
  if (draft?.port !== undefined) own.push("sshPort");
  if (draft?.username !== undefined) own.push("username");
  if (draft?.authType !== undefined) own.push("auth");
  return { [CORE_NAMESPACE]: own };
}
