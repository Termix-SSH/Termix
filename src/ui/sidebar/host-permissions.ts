import type { Host, SharePermissionLevel } from "@/types/ui-types";
import {
  SSH_AUTH_PROTOCOL,
  type AuthOverrideProtocol,
} from "@/types/auth-protocols";
import {
  listHostProtocols,
  protocolEnabled,
  type HostProtocolDef,
} from "./host-protocols";

const LEVEL_RANK: Record<SharePermissionLevel, number> = {
  connect: 1,
  view: 2,
  edit: 3,
  manage: 4,
};

function sharedLevelRank(host: Host): number {
  return LEVEL_RANK[host.permissionLevel ?? "connect"] ?? 1;
}

export function canViewHostConfig(host: Host): boolean {
  return !host.isShared || sharedLevelRank(host) >= LEVEL_RANK.view;
}

export function canEditHost(host: Host): boolean {
  return !host.isShared || sharedLevelRank(host) >= LEVEL_RANK.edit;
}

export function canShareHost(host: Host): boolean {
  return !host.isShared || sharedLevelRank(host) >= LEVEL_RANK.manage;
}

export function canDeleteHost(host: Host): boolean {
  return !host.isShared;
}

/** SSH, then every protocol a running plugin registered. */
export function authOverrideProtocols(
  list: HostProtocolDef[] = listHostProtocols(),
): AuthOverrideProtocol[] {
  return [SSH_AUTH_PROTOCOL, ...list.map((protocol) => protocol.id)];
}

/** How a protocol is named in the override menu and dialog. */
export function authProtocolLabel(
  protocol: AuthOverrideProtocol,
  t: (key: string) => string,
  list: HostProtocolDef[] = listHostProtocols(),
): string {
  if (protocol === SSH_AUTH_PROTOCOL) return "SSH";
  const def = list.find((entry) => entry.id === protocol);
  return def ? t(def.titleKey) : protocol;
}

export function canOverrideHostAuth(
  host: Host,
  protocol: AuthOverrideProtocol,
): boolean {
  if (!host.isShared) return false;
  if (protocol === SSH_AUTH_PROTOCOL) return !!host.enableSsh;
  // Other protocols are switched on in their plugin's host settings.
  const plugin = listHostProtocols().find((entry) => entry.id === protocol);
  return !!plugin && protocolEnabled(host.pluginSettings, plugin);
}
