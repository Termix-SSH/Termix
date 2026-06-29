export type ContainerRuntime = "docker" | "podman";

export function normalizeContainerRuntime(value: unknown): ContainerRuntime {
  return value === "podman" ? "podman" : "docker";
}

export function getContainerRuntimeConfig(raw: unknown): {
  runtime: ContainerRuntime;
} {
  if (!raw) {
    return { runtime: "docker" };
  }

  let config: unknown = raw;
  if (typeof raw === "string") {
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { runtime: "docker" };
    }
  }

  if (!config || typeof config !== "object") {
    return { runtime: "docker" };
  }

  return {
    runtime: normalizeContainerRuntime(
      (config as Record<string, unknown>).runtime,
    ),
  };
}

export function containerCommand(
  runtime: ContainerRuntime | undefined,
  args: string,
): string {
  return `${normalizeContainerRuntime(runtime)} ${args}`;
}

export function getRuntimeLabel(runtime: ContainerRuntime): string {
  return runtime === "podman" ? "Podman" : "Docker";
}
