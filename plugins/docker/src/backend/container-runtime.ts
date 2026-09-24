export type ContainerRuntime = "docker" | "podman";

export function normalizeContainerRuntime(value: unknown): ContainerRuntime {
  return value === "podman" ? "podman" : "docker";
}

/**
 * Non-interactive SSH shells don't source ~/.zprofile or ~/.bash_profile,
 * so PATH additions from installers like Homebrew or OrbStack are missing.
 * Extend PATH with their common install locations before invoking the CLI.
 */
const EXTRA_PATH_DIRS =
  '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:"$HOME/.orbstack/bin"';

export function containerCommand(
  runtime: ContainerRuntime | undefined,
  args: string,
): string {
  return `PATH="${EXTRA_PATH_DIRS}:$PATH" ${normalizeContainerRuntime(runtime)} ${args}`;
}

export function getRuntimeLabel(runtime: ContainerRuntime): string {
  return runtime === "podman" ? "Podman" : "Docker";
}
