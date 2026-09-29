/**
 * The host protocols plugins declare in contributes.protocols, read from
 * every installed plugin's manifest (enabled or not), so core can store,
 * share and sync a protocol's login without the plugin's code running.
 */

import type { PluginProtocolContribution } from "@termix/plugin-sdk/manifest";
import { SSH_AUTH_PROTOCOL } from "../../../types/auth-protocols.js";

export interface DeclaredHostProtocol extends PluginProtocolContribution {
  pluginId: string;
  pluginName: string;
}

let source: () => DeclaredHostProtocol[] = () => [];

export function setHostProtocolSource(
  next: () => DeclaredHostProtocol[],
): void {
  source = next;
}

/** One entry per protocol id; the first plugin to declare an id keeps it. */
export function listHostProtocols(): DeclaredHostProtocol[] {
  const seen = new Set<string>();
  const out: DeclaredHostProtocol[] = [];
  for (const protocol of source()) {
    if (seen.has(protocol.id)) continue;
    seen.add(protocol.id);
    out.push(protocol);
  }
  return out;
}

export function findHostProtocol(
  id: unknown,
): DeclaredHostProtocol | undefined {
  if (typeof id !== "string") return undefined;
  return listHostProtocols().find((protocol) => protocol.id === id);
}

export function isHostProtocol(id: unknown): id is string {
  return !!findHostProtocol(id);
}

export function secretFieldKeys(
  protocol: PluginProtocolContribution,
): string[] {
  return (protocol.credentialFields ?? [])
    .filter((field) => field.secret === true)
    .map((field) => field.key);
}

export function plainFieldKeys(protocol: PluginProtocolContribution): string[] {
  return (protocol.credentialFields ?? [])
    .filter((field) => field.secret !== true)
    .map((field) => field.key);
}

/** "ssh" or a declared protocol: what a shared recipient may override. */
export function isAuthOverrideProtocol(value: unknown): value is string {
  return value === SSH_AUTH_PROTOCOL || isHostProtocol(value);
}
