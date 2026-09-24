import type { Host, TabType } from "@/types/ui-types";
import {
  defaultConnectAction,
  hostActionsFor,
  listHostActions,
} from "@/sidebar/host-contributions";

/**
 * Which tab a click on a host opens. The ways to connect (SSH terminal, RDP,
 * VNC, Telnet) are host actions that plugins register, so the answer is the
 * highest-priority connect action the host allows, or null when no running
 * plugin can connect to it.
 */
export function getDefaultConnectionTab(host: Host): TabType | null {
  return defaultConnectAction(listHostActions(), host)?.tabType ?? null;
}

/**
 * The preferred tab if the host allows it. A connect tab type the host has
 * switched off falls back to the host's default; any other type is taken as
 * asked.
 */
export function resolveHostTabType(
  host: Host,
  preferredType?: TabType,
): TabType | null {
  if (!preferredType) return getDefaultConnectionTab(host);
  const all = listHostActions();
  const isConnectType = all.some(
    (action) => action.kind === "connect" && action.tabType === preferredType,
  );
  if (!isConnectType) return preferredType;
  const allowed = hostActionsFor(all, host, "connect").some(
    (action) => action.tabType === preferredType,
  );
  return allowed ? preferredType : getDefaultConnectionTab(host);
}
