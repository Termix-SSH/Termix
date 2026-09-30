/**
 * Where a connection is. Core's SSH pipeline uses the named stages; a plugin
 * may log its own (such as "guac_ready") and they pass through unchanged.
 */
export type ConnectionStage =
  | "dns"
  | "tcp"
  | "handshake"
  | "auth"
  | "connected"
  | "connection"
  | "error"
  | "proxy"
  | "jump"
  | "validation"
  | (string & {});

export type LogEntry = {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  stage: ConnectionStage;
  message: string;
  details?: Record<string, unknown> | string;
};
