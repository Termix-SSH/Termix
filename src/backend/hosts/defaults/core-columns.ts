/**
 * Core host defaults in column form.
 *
 * A host row (or the column object a host route builds before its write) is
 * read into a default's value and written back from one. Both directions go
 * through the catalog's normalize, so a value compares the same however the
 * row spelled it.
 */

import {
  findCoreHostDefault,
  normalizeAuthDefault,
  normalizeSocks5Default,
} from "../../../types/host-defaults.js";
import { parseSshOptions } from "../ssh-options.js";

type Columns = Record<string, unknown>;

const SSH_OPTION_DEFAULTS = [
  "keepaliveInterval",
  "keepaliveCountMax",
  "allowLegacyAlgorithms",
  "agentForwarding",
  "environmentVariables",
] as const;

function isSshOptionDefault(key: string): boolean {
  return (SSH_OPTION_DEFAULTS as readonly string[]).includes(key);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** The value a core key has on a row, normalized. */
export function readCoreDefault(
  key: string,
  row: Columns,
  storedSshOptions?: unknown,
): unknown {
  const entry = findCoreHostDefault(key);
  if (!entry) return undefined;
  const sshOptions = parseSshOptions(
    row.sshOptions !== undefined ? row.sshOptions : storedSshOptions,
  ) as Record<string, unknown>;

  switch (key) {
    case "username":
      return entry.normalize(row.username);
    case "sshPort":
      return entry.normalize(row.sshPort ?? row.port);
    case "auth":
      return normalizeAuthDefault({
        authType: row.authType,
        credentialId: row.credentialId,
        overrideCredentialUsername: asBoolean(row.overrideCredentialUsername),
        agentSocketPath: sshOptions.agentSocketPath,
        agentIdentity: sshOptions.agentIdentity,
      });
    case "forceKeyboardInteractive":
      return entry.normalize(row.forceKeyboardInteractive);
    case "socks5":
      return normalizeSocks5Default({
        useSocks5: asBoolean(row.useSocks5),
        socks5Host: row.socks5Host,
        socks5Port: row.socks5Port,
        socks5Username: row.socks5Username,
        socks5ProxyChain: row.socks5ProxyChain,
      });
    case "jumpHosts":
    case "portKnockSequence":
    case "statusCheckEnabled":
    case "statusCheckInterval":
      return entry.normalize(row[key]);
    default:
      if (isSshOptionDefault(key)) return entry.normalize(sshOptions[key]);
      return undefined;
  }
}

/**
 * The column patch that gives a row this value. `row` is read for what the
 * patch depends on: the connection type (an SSH host's port follows its SSH
 * port) and the SSH options the others share a column with.
 */
export function writeCoreDefault(
  key: string,
  value: unknown,
  row: Columns,
  storedSshOptions?: unknown,
): Columns {
  const entry = findCoreHostDefault(key);
  if (!entry) return {};
  const normalized = entry.normalize(value);

  if (isSshOptionDefault(key) || key === "auth") {
    const current = parseSshOptions(
      row.sshOptions !== undefined ? row.sshOptions : storedSshOptions,
    ) as Record<string, unknown>;
    if (key === "auth") {
      const auth = normalizeAuthDefault(value);
      if (!auth) return {};
      const next = { ...current };
      if (auth.authType === "agent") {
        next.agentSocketPath = auth.agentSocketPath;
        next.agentIdentity = auth.agentIdentity;
      } else {
        delete next.agentSocketPath;
        delete next.agentIdentity;
      }
      // A credential host may keep its own password next to the credential;
      // every other secretless type has no use for one.
      return {
        authType: auth.authType,
        credentialId: auth.credentialId,
        overrideCredentialUsername: auth.overrideCredentialUsername,
        sshOptions: JSON.stringify(next),
        ...(auth.authType === "credential" ? {} : { password: null }),
        key: null,
        keyPassword: null,
        keyType: null,
      };
    }
    return { sshOptions: JSON.stringify({ ...current, [key]: normalized }) };
  }

  switch (key) {
    case "username":
      return normalized === null ? {} : { username: normalized };
    case "sshPort": {
      const patch: Columns = { sshPort: normalized };
      if ((row.connectionType ?? "ssh") === "ssh") patch.port = normalized;
      return patch;
    }
    case "forceKeyboardInteractive":
      return { forceKeyboardInteractive: normalized ? "true" : "false" };
    case "socks5": {
      const socks = normalizeSocks5Default(value);
      return {
        useSocks5: socks.useSocks5,
        socks5Host: socks.socks5Host,
        socks5Port: socks.socks5Port,
        socks5Username: socks.socks5Username,
        socks5ProxyChain: socks.socks5ProxyChain
          ? JSON.stringify(mergeChainPasswords(socks.socks5ProxyChain, row))
          : null,
      };
    }
    case "jumpHosts":
    case "portKnockSequence":
      return {
        [key]:
          Array.isArray(normalized) && normalized.length > 0
            ? JSON.stringify(normalized)
            : null,
      };
    case "statusCheckEnabled":
      return { statusCheckEnabled: !!normalized };
    case "statusCheckInterval":
      return { statusCheckInterval: normalized };
    default:
      return {};
  }
}

/** A chain that follows a default keeps the passwords the host saved for it. */
function mergeChainPasswords(chain: unknown[], row: Columns): unknown[] {
  let current: unknown = row.socks5ProxyChain;
  if (typeof current === "string") {
    try {
      current = JSON.parse(current);
    } catch {
      current = [];
    }
  }
  const saved = Array.isArray(current) ? current : [];
  return chain.map((node, index) => {
    const own = saved[index] as Record<string, unknown> | undefined;
    const password = own?.password;
    return typeof password === "string" && password
      ? { ...(node as Record<string, unknown>), password }
      : node;
  });
}
