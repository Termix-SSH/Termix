import type { ConnectionStage, LogEntry } from "../../types/connection-log.js";

export function createConnectionLog(
  type: "info" | "success" | "warning" | "error",
  stage: ConnectionStage,
  message: string,
  details?: Record<string, unknown>,
): Omit<LogEntry, "id" | "timestamp"> {
  return {
    type,
    stage,
    message,
    details,
  };
}
