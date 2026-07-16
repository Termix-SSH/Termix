import type { Host, SharePermissionLevel } from "@/types/ui-types";

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
