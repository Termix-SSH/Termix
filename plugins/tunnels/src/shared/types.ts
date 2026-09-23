export type TunnelScope = "s2s" | "c2s";
export type TunnelMode = "local" | "remote" | "dynamic";

export const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  VERIFYING: "verifying",
  FAILED: "failed",
  UNSTABLE: "unstable",
  RETRYING: "retrying",
  WAITING: "waiting",
  DISCONNECTING: "disconnecting",
} as const;

export type ConnectionState =
  (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

export type TunnelErrorType =
  | "CONNECTION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

/** One saved tunnel, as a host's tunnelConnections setting or a C2S preset holds it. */
export interface TunnelConnection {
  scope?: TunnelScope;
  mode?: TunnelMode;
  tunnelType?: "local" | "remote";
  localAddress?: string;
  remoteAddress?: string;
  bindHost?: string;
  sourceHostId?: number;
  sourceHostSyncId?: string;
  sourceHostName?: string;
  sourcePort: number;
  endpointPort: number;
  endpointHost?: string;
  targetHost?: string;
  /** Seconds. */
  retryInterval: number;
  maxRetries: number;
  autoStart: boolean;
  displayName?: string;
}

/** What POST /connect takes. Credentials are always resolved server side. */
export interface TunnelConnectRequest {
  name: string;
  sourceHostId: number;
  tunnelIndex: number;
  scope?: TunnelScope;
  mode?: TunnelMode;
  tunnelType?: "local" | "remote";
  bindHost?: string;
  targetHost?: string;
  endpointHost?: string;
  sourcePort: number;
  endpointPort: number;
  maxRetries?: number;
  /** Seconds. */
  retryInterval?: number;
  autoStart?: boolean;
}

export interface TunnelStatus {
  connected: boolean;
  status: ConnectionState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryIn?: number;
  reason?: string;
  errorType?: TunnelErrorType;
  manualDisconnect?: boolean;
  retryExhausted?: boolean;
}

export interface C2STunnelPreset {
  id: number;
  userId: string;
  name: string;
  config: TunnelConnection[];
  platform?: string | null;
  computerName?: string | null;
  createdAt: string;
  updatedAt: string;
}
