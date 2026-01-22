export type ConnectionStage =
  // SSH/Terminal stages
  | "dns"
  | "tcp"
  | "handshake"
  | "auth"
  | "connected"
  | "connection"
  | "error"
  | "proxy"
  | "jump"
  // Docker stages
  | "docker_connecting"
  | "docker_auth"
  | "docker_session"
  | "docker_ready"
  // Stats stages
  | "stats_connecting"
  | "stats_totp"
  | "stats_polling"
  | "stats_heartbeat"
  // Tunnel stages
  | "tunnel_connecting"
  | "tunnel_source"
  | "tunnel_endpoint"
  | "tunnel_forwarding"
  | "tunnel_retry"
  | "tunnel_connected"
  // SFTP stages
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
