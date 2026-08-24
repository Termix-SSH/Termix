export type HostStatus = "online" | "reachable" | "offline";

export function statusAfterReachabilityCheck(
  reachable: boolean,
  current?: HostStatus,
): HostStatus {
  if (!reachable) return "offline";
  return current === "online" ? "online" : "reachable";
}

export function statusAfterAuthentication(
  authenticated: boolean,
  current?: HostStatus,
): HostStatus {
  if (authenticated) return "online";
  return current === "offline" ? "offline" : "reachable";
}

/**
 * Whether the cheap status probe must also authenticate over SSH.
 *
 * "online" means authenticated, and normally the metrics poll proves that.
 * That poll only runs while someone is viewing the host, so an unwatched host
 * with metrics enabled would otherwise never leave "reachable" - while a host
 * with metrics disabled, whose probe always authenticates, shows online.
 */
export function needsStatusPollAuthentication(
  metricsEnabled: boolean,
  hasViewers: boolean,
): boolean {
  return !metricsEnabled || !hasViewers;
}
