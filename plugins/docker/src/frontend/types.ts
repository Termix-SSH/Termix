export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state:
    | "created"
    | "running"
    | "paused"
    | "restarting"
    | "removing"
    | "exited"
    | "dead";
  ports: string;
  created: string;
  command?: string;
  labels?: Record<string, string>;
  networks?: string[];
  mounts?: string[];
}

export interface DockerStats {
  cpu: string;
  memoryUsed: string;
  memoryLimit: string;
  memoryPercent: string;
  netInput: string;
  netOutput: string;
  blockRead: string;
  blockWrite: string;
  pids?: string;
}

export interface DockerLogOptions {
  tail?: number;
  timestamps?: boolean;
  since?: string;
  until?: string;
  follow?: boolean;
}

export interface DockerValidation {
  available: boolean;
  version?: string;
  runtime?: "docker" | "podman";
  error?: string;
  code?: string;
}

/** What the Docker views read from a host. */
export interface DockerHost {
  id: number;
  name?: string;
  ip: string;
  port: number;
  username?: string;
  syncId?: string | null;
  connectionOrigin?: "local" | "remote" | null;
  terminalConfig?: Record<string, unknown> | null;
  pluginSettings?: Record<string, Record<string, unknown> | undefined>;
}

/** Any host record the shell or an API hands over, as a DockerHost. */
export function toDockerHost(record: Record<string, unknown>): DockerHost {
  return {
    ...(record as unknown as DockerHost),
    id: Number(record.id),
  };
}

function dockerSettings(
  host: object | null | undefined,
): Record<string, unknown> {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.docker ?? {};
}

export function dockerEnabled(host: object | null | undefined): boolean {
  return dockerSettings(host).enableDocker === true;
}

export function hostTitle(host: DockerHost): string {
  return host.name || `${host.username ?? ""}@${host.ip}`;
}
