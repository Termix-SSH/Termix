import type { TunnelMode, TunnelScope } from "../shared/types.js";

export type {
  C2STunnelPreset,
  ConnectionState,
  TunnelConnectRequest,
  TunnelConnection,
  TunnelErrorType,
  TunnelMode,
  TunnelScope,
  TunnelStatus,
} from "../shared/types.js";
export { CONNECTION_STATES } from "../shared/types.js";

/**
 * A tunnel as the manager runs it. Built server side from a saved connection
 * or a connect request; it never carries credentials; both SSH legs resolve
 * theirs through ctx.ssh.
 */
export interface TunnelConfig {
  name: string;
  scope?: TunnelScope;
  mode?: TunnelMode;
  tunnelType?: "local" | "remote";
  localAddress?: string;
  remoteAddress?: string;
  bindHost?: string;
  targetHost?: string;

  sourceHostId: number;
  sourceHostSyncId?: string;
  tunnelIndex: number;
  /** Who the SSH connections run as. */
  requestingUserId: string;

  hostName: string;
  sourceIP: string;
  sourceSSHPort: number;
  sourceUsername: string;

  endpointHost: string;
  /** The Termix host the endpoint leg connects to, when there is one. */
  endpointHostId?: number;
  endpointIP?: string;
  endpointSSHPort?: number;
  endpointUsername?: string;

  sourcePort: number;
  endpointPort: number;
  maxRetries: number;
  /** Milliseconds. */
  retryInterval: number;
  autoStart: boolean;

  /**
   * When set, the tunnel closes itself once it has had no connected sockets
   * for this long. forward() uses it for on-demand tunnels.
   */
  idleTimeoutMs?: number;
}
