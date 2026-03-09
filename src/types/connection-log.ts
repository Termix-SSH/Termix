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
  | "docker_connecting"
  | "docker_auth"
  | "docker_session"
  | "docker_ready"
  | "stats_connecting"
  | "stats_totp"
  | "stats_polling"
  | "stats_heartbeat"
  | "tunnel_connecting"
  | "tunnel_source"
  | "tunnel_endpoint"
  | "tunnel_forwarding"
  | "tunnel_retry"
  | "tunnel_connected"
  | "sftp_connecting"
  | "sftp_auth"
  | "sftp_connected";

export type LogEntry = {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  stage: ConnectionStage;
  message: string;
  details?: Record<string, any>;
};

export interface ConnectionLogResponse {
  connectionLogs?: LogEntry[];
}
