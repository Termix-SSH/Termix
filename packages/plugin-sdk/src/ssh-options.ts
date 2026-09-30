/**
 * A host's SSH connection options, as core's connect pipeline reads them
 * (`ssh_data.ssh_options`). Shared by the backend and frontend host records.
 */
export interface HostSshOptions {
  /** Seconds between keepalive packets. */
  keepaliveInterval?: number;
  /** Missed keepalives before the connection is dropped. */
  keepaliveCountMax?: number;
  /** Offer older key exchange, cipher and MAC algorithms. On unless false. */
  allowLegacyAlgorithms?: boolean;
  /** Agent auth: the agent socket to use instead of the default. */
  agentSocketPath?: string | null;
  /** Agent auth: the key comment or fingerprint to offer first. */
  agentIdentity?: string | null;
  /** Forward the agent (or the host's key) into the session. */
  agentForwarding?: boolean;
  /** Variables exported into an interactive session. */
  environmentVariables?: Array<{ key: string; value: string }>;
}
