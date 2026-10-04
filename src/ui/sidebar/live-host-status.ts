import type { Host, HostFolder } from "@/types/ui-types";
import type { StatusValue } from "@/lib/server-status-store";
import { isFolder } from "./tree/visible-rows";

/**
 * Copies each host's live status onto the tree so sorting, filtering and
 * grouping by status read the same value as the row's dot. A host with
 * status checks off gets no status.
 */
export function withLiveStatus(
  folder: HostFolder,
  getStatus: (hostId: number) => StatusValue,
): HostFolder {
  return {
    ...folder,
    children: folder.children.map((child) => {
      if (isFolder(child)) return withLiveStatus(child, getStatus);
      const host = child as Host;
      const status =
        host.statusCheckEnabled === false
          ? undefined
          : getStatus(Number(host.id));
      if (host.status === status) return host;
      return { ...host, status, online: status === "online" };
    }),
  };
}

/** The flat-list version of withLiveStatus. */
export function withLiveHostStatus(
  hosts: Host[],
  getStatus: (hostId: number) => StatusValue,
): Host[] {
  return withLiveStatus({ name: "", children: hosts }, getStatus)
    .children as Host[];
}
