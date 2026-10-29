/**
 * Docker and Podman command builders and output parsers.
 *
 * Container ids and names are checked with CONTAINER_ID_RE before they go on
 * a command line, so they need no quoting. Anything free form is quoted.
 */
import { HostScriptError } from "./text.js";

export type ContainerRuntime = "docker" | "podman";

export function normalizeContainerRuntime(value: unknown): ContainerRuntime {
  return value === "podman" ? "podman" : "docker";
}

export function getRuntimeLabel(runtime: ContainerRuntime): string {
  return runtime === "podman" ? "Podman" : "Docker";
}

/**
 * Non-interactive SSH shells don't source ~/.zprofile or ~/.bash_profile,
 * so PATH additions from installers like Homebrew or OrbStack are missing.
 */
export const EXTRA_PATH_DIRS =
  '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:"$HOME/.orbstack/bin"';

export function containerCommand(
  runtime: ContainerRuntime | undefined,
  args: string,
  isWindows = false,
): string {
  const cli = `${normalizeContainerRuntime(runtime)} ${args}`;
  // cmd and PowerShell don't understand the POSIX env prefix.
  return isWindows ? cli : `PATH="${EXTRA_PATH_DIRS}:$PATH" ${cli}`;
}

export const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export const DOCKER_TIMESTAMP_RE = /^[0-9T:.Z+-]+$/;

export function isContainerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    CONTAINER_ID_RE.test(value)
  );
}

function requireContainer(id: string): string {
  if (!isContainerId(id))
    throw new HostScriptError("That is not a valid container id");
  return id;
}

export const CONTAINER_ACTIONS = [
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
] as const;
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

const LIST_FORMAT_UNIX = `'{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}"}' `;
const LIST_FORMAT_WINDOWS = `"{\\"id\\":\\"{{.ID}}\\",\\"name\\":\\"{{.Names}}\\",\\"image\\":\\"{{.Image}}\\",\\"status\\":\\"{{.Status}}\\",\\"state\\":\\"{{.State}}\\",\\"ports\\":\\"{{.Ports}}\\",\\"created\\":\\"{{.CreatedAt}}\\"}"`;
const STATS_FORMAT_UNIX = `'{"cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memoryPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}' `;
const STATS_FORMAT_WINDOWS = `"{\\"cpu\\":\\"{{.CPUPerc}}\\",\\"memory\\":\\"{{.MemUsage}}\\",\\"memoryPercent\\":\\"{{.MemPerc}}\\",\\"netIO\\":\\"{{.NetIO}}\\",\\"blockIO\\":\\"{{.BlockIO}}\\",\\"pids\\":\\"{{.PIDs}}\\"}"`;

export function listFormat(isWindows: boolean): string {
  return isWindows ? LIST_FORMAT_WINDOWS : LIST_FORMAT_UNIX;
}

export function statsFormat(isWindows: boolean): string {
  return isWindows ? STATS_FORMAT_WINDOWS : STATS_FORMAT_UNIX;
}

/** One row of `ps --format listFormat()`. */
export interface ContainerRow {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

/** CLI arguments, without the runtime, for each container command. */
export const dockerArgs = {
  version: () => "--version",
  ping: () => "ps",
  list: (all: boolean, isWindows = false) =>
    `ps ${all ? "-a " : ""}--format ${listFormat(isWindows)}`,
  inspect: (id: string) => `inspect ${requireContainer(id)}`,
  stats: (id: string, isWindows = false) =>
    `stats ${requireContainer(id)} --no-stream --format ${statsFormat(isWindows)}`,
  action: (action: ContainerAction, id: string) => {
    if (!CONTAINER_ACTIONS.includes(action))
      throw new HostScriptError("Unknown action");
    return `${action} ${requireContainer(id)}`;
  },
  remove: (id: string, force: boolean) =>
    `rm ${force ? "-f " : ""}${requireContainer(id)}`,
  logs: (
    id: string,
    options: {
      tail?: number;
      timestamps?: boolean;
      since?: string;
      until?: string;
    } = {},
  ) => {
    let args = `logs ${requireContainer(id)}`;
    if (options.tail && options.tail > 0)
      args += ` --tail ${Math.floor(options.tail)}`;
    if (options.timestamps) args += " --timestamps";
    if (options.since && DOCKER_TIMESTAMP_RE.test(options.since)) {
      args += ` --since ${options.since}`;
    }
    if (options.until && DOCKER_TIMESTAMP_RE.test(options.until)) {
      args += ` --until ${options.until}`;
    }
    return `${args} 2>&1`;
  },
  states: () => `ps -a --format ${PS_STATE_FORMAT}`,
  composeProjects: () => "compose ls -a --format json",
};

/** The version from `docker --version` or `podman --version`. */
export function parseRuntimeVersion(output: string): string {
  return output.match(/(?:Docker|podman) version ([^\s,]+)/i)?.[1] ?? "unknown";
}

export type RuntimeProblem =
  "NOT_INSTALLED" | "DAEMON_NOT_RUNNING" | "PERMISSION_DENIED" | "DOCKER_ERROR";

/** Sorts a failed `docker ps` into a reason the UI can explain. */
export function classifyRuntimeError(message: string): RuntimeProblem {
  if (
    /command not found|not found: (docker|podman)|No such file or directory/i.test(
      message,
    )
  ) {
    return "NOT_INSTALLED";
  }
  if (message.includes("Cannot connect to the Docker daemon"))
    return "DAEMON_NOT_RUNNING";
  if (/permission denied/i.test(message)) return "PERMISSION_DENIED";
  return "DOCKER_ERROR";
}

/** Parses `ps --format listFormat()` output, skipping lines that are not JSON. */
export function parseContainerList(output: string): Record<string, unknown>[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

export interface ContainerStats {
  cpu: string;
  memoryUsed: string;
  memoryLimit: string;
  memoryPercent: string;
  netInput: string;
  netOutput: string;
  blockRead: string;
  blockWrite: string;
  pids: string;
}

/** Parses one `stats --no-stream --format statsFormat()` line. Throws on bad JSON. */
export function parseContainerStats(output: string): ContainerStats {
  const raw = JSON.parse(output.trim()) as Record<string, string>;
  const split = (value: string | undefined) => {
    const [first, second] = (value ?? "").split(" / ");
    return [first?.trim() || "0B", second?.trim() || "0B"];
  };
  const [memoryUsed, memoryLimit] = split(raw.memory);
  const [netInput, netOutput] = split(raw.netIO);
  const [blockRead, blockWrite] = split(raw.blockIO);
  return {
    cpu: raw.cpu,
    memoryUsed,
    memoryLimit,
    memoryPercent: raw.memoryPercent,
    netInput,
    netOutput,
    blockRead,
    blockWrite,
    pids: raw.pids,
  };
}

export interface ContainerState {
  /** Docker's own state word: running, exited, restarting, ... */
  state: string;
  /** Health from the status text, when the image declares a healthcheck. */
  unhealthy: boolean;
}

export type DockerEventName = "exited" | "started" | "unhealthy" | "restarting";

export const PS_STATE_FORMAT = `'{"name":"{{.Names}}","state":"{{.State}}","status":"{{.Status}}"}'`;

/** Parses `ps -a --format PS_STATE_FORMAT` output, one JSON object per line. */
export function parseContainerStates(
  output: string,
): Map<string, ContainerState> {
  const states = new Map<string, ContainerState>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        name?: string;
        state?: string;
        status?: string;
      };
      if (!parsed.name) continue;
      states.set(parsed.name, {
        state: (parsed.state ?? "").toLowerCase(),
        unhealthy: /\(unhealthy\)/i.test(parsed.status ?? ""),
      });
    } catch {
      // A partial line is not worth failing the whole poll over.
    }
  }
  return states;
}

/**
 * The events a pair of snapshots implies. A container missing from the
 * previous snapshot counts as newly seen rather than started, so the first
 * poll after a restart does not replay every running container.
 */
export function diffContainerStates(
  previous: Map<string, ContainerState>,
  current: Map<string, ContainerState>,
): Array<{ container: string; event: DockerEventName }> {
  const events: Array<{ container: string; event: DockerEventName }> = [];
  for (const [name, now] of current) {
    const before = previous.get(name);
    if (!before) continue;
    if (before.state !== now.state) {
      if (now.state === "exited")
        events.push({ container: name, event: "exited" });
      else if (now.state === "running")
        events.push({ container: name, event: "started" });
      else if (now.state === "restarting") {
        events.push({ container: name, event: "restarting" });
      }
    }
    // A container can go unhealthy while it stays up.
    if (!before.unhealthy && now.unhealthy) {
      events.push({ container: name, event: "unhealthy" });
    }
  }
  return events;
}

export interface ContainerCounts {
  running: number;
  stopped: number;
  unhealthy: number;
  total: number;
}

/** Counts from `ps -a --format PS_STATE_FORMAT` output. */
export function countContainers(output: string): ContainerCounts {
  const states = [...parseContainerStates(output).values()];
  const running = states.filter((s) => s.state === "running").length;
  return {
    running,
    stopped: states.length - running,
    unhealthy: states.filter((s) => s.unhealthy).length,
    total: states.length,
  };
}

// Compose stacks

export const STACK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
export const STACK_SERVICE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,126}$/;
export const COMPOSE_FILES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
];

export const STACK_ACTIONS = [
  "deploy",
  "redeploy",
  "pull",
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
  "down",
  "destroy",
] as const;
export type StackAction = (typeof STACK_ACTIONS)[number];

/** Actions that can target one service of a stack. */
export const STACK_SERVICE_ACTIONS: StackAction[] = [
  "deploy",
  "pull",
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
];

export type StackState =
  "running" | "partial" | "stopped" | "paused" | "not-deployed";

export interface StackSummary {
  name: string;
  managed: boolean;
  state: StackState;
  running: number;
  total: number;
  composeFile: string | null;
}

export interface StackService {
  service: string;
  name: string;
  id: string;
  image: string;
  state: string;
  status: string;
  health: string;
  ports: string;
}

/** `compose ls` and `compose ps --format json` print one object per line or one array. */
export function parseJsonLines(output: string): Record<string, unknown>[] {
  const text = output.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      return JSON.parse(text) as Record<string, unknown>[];
    } catch {
      return [];
    }
  }
  return text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function parseServices(output: string): StackService[] {
  return parseJsonLines(output).map((row) => {
    const publishers = Array.isArray(row.Publishers)
      ? (row.Publishers as Record<string, unknown>[])
      : [];
    const ports = publishers
      .filter((p) => Number(p.PublishedPort) > 0)
      .map((p) => `${p.PublishedPort}:${p.TargetPort}`)
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(", ");
    return {
      service: str(row.Service),
      name: str(row.Name),
      id: str(row.ID),
      image: str(row.Image),
      state: str(row.State),
      status: str(row.Status),
      health: str(row.Health),
      ports,
    };
  });
}

function stateOf(running: number, paused: number, total: number): StackState {
  if (total === 0) return "not-deployed";
  if (paused === total) return "paused";
  if (running === total) return "running";
  if (running > 0) return "partial";
  return "stopped";
}

/** Turns the `compose ls` status text ("running(2), exited(1)") into a state. */
export function parseStackStatus(status: string): {
  state: StackState;
  running: number;
  total: number;
} {
  let running = 0;
  let paused = 0;
  let total = 0;
  for (const part of status.split(",")) {
    const match = part.trim().match(/^([a-z]+)\((\d+)\)$/i);
    if (!match) continue;
    const count = Number(match[2]);
    total += count;
    if (match[1] === "running") running += count;
    if (match[1] === "paused") paused += count;
  }
  return { state: stateOf(running, paused, total), running, total };
}

export function stackStateFromServices(services: StackService[]) {
  const total = services.length;
  const running = services.filter((s) => s.state === "running").length;
  const paused = services.filter((s) => s.state === "paused").length;
  return { state: stateOf(running, paused, total), running, total };
}

/** Stacks from `compose ls -a --format json`, for hosts with no stacks folder. */
export function parseComposeProjects(output: string): StackSummary[] {
  return parseJsonLines(output)
    .flatMap((project) => {
      const name = str(project.Name);
      if (!STACK_NAME_RE.test(name)) return [];
      return [
        {
          name,
          managed: false,
          ...parseStackStatus(str(project.Status)),
          composeFile: str(project.ConfigFiles).split(",")[0] || null,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The compose commands one action runs, in order. */
export function composeArgsFor(
  action: StackAction,
  service: string | undefined,
  options: { removeVolumes?: boolean },
): string[] {
  const target = service ? ` ${service}` : "";
  switch (action) {
    case "deploy":
      return [`up -d --remove-orphans${target}`];
    case "redeploy":
      return [`pull${target}`, `up -d --remove-orphans${target}`];
    case "pull":
      return [`pull${target}`];
    case "start":
    case "stop":
    case "restart":
    case "pause":
    case "unpause":
      return [`${action}${target}`];
    case "down":
      return ["down --remove-orphans"];
    case "destroy":
      return [`down --remove-orphans${options.removeVolumes ? " -v" : ""}`];
  }
}
