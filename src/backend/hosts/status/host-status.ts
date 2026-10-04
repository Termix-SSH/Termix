export type HostStatus = "online" | "offline";

export function isHostKeyVerificationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Host denied (verification failed)") ||
      error.message.includes("Host key changed"))
  );
}
