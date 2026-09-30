/**
 * A host's SSH connection options (`ssh_data.ssh_options`).
 *
 * These lived in `terminal_config` next to the terminal's look until 2.9.0.
 * The connect pipeline reads them for every SSH connection, not only the
 * terminal's, so they are core's and have a column of their own.
 */

import type { HostSshOptions } from "@termix/plugin-sdk/backend";

export type { HostSshOptions };

export const SSH_OPTION_KEYS = [
  "keepaliveInterval",
  "keepaliveCountMax",
  "allowLegacyAlgorithms",
  "agentSocketPath",
  "agentIdentity",
  "agentForwarding",
  "environmentVariables",
] as const satisfies readonly (keyof HostSshOptions)[];

function asObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed) return null;
    try {
      parsed = JSON.parse(parsed);
      // Some rows were stringified twice.
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/**
 * The SSH options in a value (a JSON string or an object), typed and with
 * anything else dropped. A terminal_config value works too, which is how the
 * 2.8 keys are read.
 */
export function parseSshOptions(value: unknown): HostSshOptions {
  const source = asObject(value);
  if (!source) return {};
  const options: HostSshOptions = {};

  const keepaliveInterval = finiteNumber(source.keepaliveInterval);
  if (keepaliveInterval !== undefined)
    options.keepaliveInterval = keepaliveInterval;
  const keepaliveCountMax = finiteNumber(source.keepaliveCountMax);
  if (keepaliveCountMax !== undefined)
    options.keepaliveCountMax = keepaliveCountMax;
  if (typeof source.allowLegacyAlgorithms === "boolean") {
    options.allowLegacyAlgorithms = source.allowLegacyAlgorithms;
  }
  const agentSocketPath = optionalString(source.agentSocketPath);
  if (agentSocketPath !== undefined) options.agentSocketPath = agentSocketPath;
  const agentIdentity = optionalString(source.agentIdentity);
  if (agentIdentity !== undefined) options.agentIdentity = agentIdentity;
  if (typeof source.agentForwarding === "boolean") {
    options.agentForwarding = source.agentForwarding;
  }
  if (Array.isArray(source.environmentVariables)) {
    options.environmentVariables = source.environmentVariables
      .filter(
        (entry): entry is { key: unknown; value: unknown } =>
          !!entry && typeof entry === "object",
      )
      .map((entry) => ({
        key: String(entry.key ?? ""),
        value: String(entry.value ?? ""),
      }));
  }
  return options;
}

/** Whether a value carries any SSH option at all. */
export function hasSshOptions(value: unknown): boolean {
  return Object.keys(parseSshOptions(value)).length > 0;
}

/**
 * The column value to store for a host write: the payload's own sshOptions,
 * or, from a client that still sends the 2.8 shape, the options inside its
 * terminalConfig. Undefined when the payload carries neither, so an update
 * leaves the column alone.
 */
export function sshOptionsForWrite(payload: {
  sshOptions?: unknown;
  terminalConfig?: unknown;
}): string | null | undefined {
  if (payload.sshOptions !== undefined) {
    if (payload.sshOptions === null) return null;
    return JSON.stringify(parseSshOptions(payload.sshOptions));
  }
  if (hasSshOptions(payload.terminalConfig)) {
    return JSON.stringify(parseSshOptions(payload.terminalConfig));
  }
  return undefined;
}
