export type HostStatus = "online" | "reachable" | "offline";

export function isHostKeyVerificationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Host denied (verification failed)") ||
      error.message.includes("Host key changed"))
  );
}

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
