import type { Host, SharePermissionLevel } from "@/types/ui-types";
import {
  isSupportedAuthOverrideProtocol,
  type AuthOverrideProtocol,
} from "@/types/auth-protocols";
import { listHostProtocols, protocolEnabled } from "./host-protocols";

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

export function canOverrideHostAuth(
  host: Host,
  protocol: AuthOverrideProtocol,
): boolean {
  if (!host.isShared || !isSupportedAuthOverrideProtocol(protocol)) {
    return false;
  }
  if (protocol === "ssh") return !!host.enableSsh;
  // Other protocols are switched on in their plugin's host settings.
  const plugin = listHostProtocols().find((entry) => entry.id === protocol);
  return !!plugin && protocolEnabled(host.pluginSettings, plugin);
}
